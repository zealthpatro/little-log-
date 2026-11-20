# Android shell and Glance widgets (P6) Implementation Plan

> **Contract note (F12, roadmap 2.3):** the small widget renders `row.whose` where `by` would go (Android has no ago line: draw "last feed · Robin", or just "last feed" when `whose` is null, never a lone "Robin"). Native `WCopy.fill` substitutes placeholders in ONE pass (baby names are free text; a baby named "{age}" must not be re-substituted), with a fixture named "{age}" in the golden tests (`small-both-name-is-a-placeholder`).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Android shell shippable (a signed AAB that signs in, App Links, no key ever committed) and give it the medium and small widgets, Sleep in place, long-press shortcuts and partner freshness that P3 to P5 give iOS, then end the declared iOS-only window.

**Architecture:** Tracked `native-android/` (shell Gradle files, manifest, Java entry point, Kotlin, resources) is copied into the gitignored `android/` by `tools/cap_android_configure.js`, which owns five scaffold files whole and never deletes anything. Kotlin ports P1's reference model and is held to its generated fixtures; Glance draws that ViewModel in five size buckets chosen by width and height; `NapActionCallback` is the only code that writes (through P4's nap route), and every other tap is an ACTION_VIEW intent into MainActivity. `tools/cap_android_build.sh` builds the AAB and runs every Mac-only gate; CI runs the string-level halves.

**Tech Stack:** Capacitor 8.4 Android, AGP 8.13.0, Gradle 8.14.3, JDK 21, Kotlin 2.2.20 with the Compose compiler plugin, Glance 1.1.1, WorkManager 2.10.0, Robolectric 4.14.1, Firebase Messaging 25.0.1 (through @capacitor-firebase/messaging 8.3), Node gates, python3 for manifest checks, bash.

**Spec:** /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c/docs/superpowers/specs/2026-11-16-home-screen-widgets-design.md (and the roadmap /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c/docs/superpowers/plans/2026-11-17-widgets-0-roadmap.md).

Paths are relative to the worktree root above (or to the worktree P6 is built in, rebased on P1 to P5). Line numbers are for 58733b16. P1 to P5 move some of them (worker.js, tools/gates.js, tools/test_wiring_check.js, tools/change_test_check.js), so re-read each range before editing. Scaffold lines marked "scaffold" are in the main checkout's gitignored `/Users/m1promax/Downloads/little-log-pwa/android/` (Capacitor 8.4, made 15 Jul), which this plan only reads.

## Contract notes

All settled in the roadmap on 17 Nov; the tasks below follow them. The sibling plans are read as landed: P1's keys, model rules M1-M15 (M13 with `pendingMs`, M15 the month day of F10), the ViewModel's row `day` and `a11y`, `header.moment` and top-level `url` (M12 with the monthcard link), SnapshotBaby `moments` and `monthMoments` in since-rules, and the generated Kotlin shape (WCopy members are resource ids, `WCopy.fill`, per-platform WActions, fixtures `{ source, tz: "UTC", fixtures }` with a fractional `cellWidth`); P3's `WColor`/`WColors` in Generated.kt, `reportWidgetKinds` and its widened test candidates (its Task 1); P4's `napCases` (its Task 9) and the revoke every native `clear()` sends (its note 7); P5's merge table, `pokedAt` and `pullTriedAt` keys and `pullMinMs` / `pullEveryMs` rules (its note 6 and Task 7).

1. **Kotlin tests in the wiring gate** (roadmap 2.10). P3's Task 1 makes `tools/*_check.sh`, `tools/*_smoke.sh` and `native-ios/Tests/*Tests.swift` candidates; Task 4 adds `/^native-android\/app\/src\/test\/java\/com\/littlecubby\/app\/widget\/[^/]+Test\.kt$/` to CANDIDATE_RES (listCandidates reads that directory). Each such file is ALLOWed with `ranBy: 'tools/android_widget_check.sh'`, which lists every file name in `EXPECTED_TESTS` and fails unless each one's JUnit XML exists with tests > 0 and no failure; tools/android_widget_check.sh itself is ALLOWed with ranBy tools/cap_android_build.sh (test_wiring_check.js fails an ALLOW entry that is not a candidate, :125).
2. **android_parity_check.js leaves ALLOW** (roadmap 2.10). Its new `--self-test` (string plants, no build, no network) is tree gate `android-parity`; `--release` runs only inside tools/cap_android_build.sh. test_wiring_check.js:111 refuses a file that is both wired and excused.
3. **Keys to words in Kotlin** (roadmap 2.3). The ViewModel carries some fields as dot keys (`message`), and Kotlin `WCopy` members are resource ids. Task 5 teaches tools/widget_gen.js to emit `WCopy.byKey: Map<String, Int>` (this platform's keys only) and regenerates; `Words.of` reads it. No `getIdentifier` lookup anywhere.
4. **The lock-screen switch on an Android phone** (roadmap 2.2 and 2.6). `window.__cubbyHasWidgets` caches the plugin's whole answer `{ value, kinds }` (false on the web), and P1 shows "Hide details on the lock screen" only when `value` is true on iOS, so an Android parent never sees a switch for a lock-screen widget Android does not have (spec section 2). The Android plugin reports `lock: 0`; Task 6 proves its answer reaches P3's `reportWidgetKinds` and the switch stays hidden.
5. **One reply table for two platforms** (roadmap 2.3). P4 Task 9's reply-to-napState rows live as data in widget-copy.json `napCases`; Task 7's NapReducerTest reads them, and this plan copies no table.
6. **Month days, one arithmetic** (F10; roadmap 2.2, 2.3, 2.5, 2.7, 2.11). The month day is computed once, by P1's `monthMoments(birthTs, now, count = 2)` in workers/shared/since-rules.mjs and its generated app/since-rules.js (index.html:3309's setMonth rule). The app writes each SnapshotBaby's `moments: [{ at, unit, n }]` (at most 2; [] with no birth, during `myLossHolding()`, or when state is not 'ok'), and P5's buildPullSnapshot writes the same field per pull baby ([] while the household's loss holding applies to the viewer, which the pull always knows from `app.lossHolding`, P5 note 8). P5 Task 7's merge draws the app's list whichever source is newer (the Worker's are UTC midnights), and [] when the pull is the newer source, has the baby and its list is [] (a holding seeded from another phone). Kotlin never computes a month day: there is no Kotlin monthMoments, the port reads `moments` as data and ports only M15 (active when `m.at <= now < m.at + 86400000`), `header.moment: { text, a11y } | null` (null in the lock families and the pregnancy kind, which Android never draws) and M12's monthcard `url`; Task 5's fixtures hold it to them. Every Android widget lives on the home screen (both providers declare `widgetCategory="home_screen"` and nothing else; Task 8 asserts it), so the views draw the moment with no location test, as they draw `by`. The `monthcard` route, its `m` key in native-bridge's whitelist and widget.opened's `moment` target are the app's (P1); the widget only opens the url, so Android adds no event and no native analytics (D8).

## Global Constraints

- D1: Kotlin plus Glance, no Kotlin Multiplatform; RemoteViews only if the Kotlin plugin destabilises the shell build, with the reason recorded here (spec 5, 9).
- D6, C3: only Sleep writes in place, through POST /api/widget/nap; every other tap opens Cubby; nothing is queued.
- Every opens-Cubby tap: ACTION_VIEW with the https URL as data, explicit to MainActivity, FLAG_IMMUTABLE; Capacitor ignores extras (spec 6.5, AppPlugin.java:145-150).
- URL: `https://little-cubby.com/app/?go=<go>&baby=<babyId|both>&from=<widget|shortcut>` (2.7); shortcuts carry no `baby`; the month card adds `m` (F10).
- Design floor: medium 276dp wide on an Android 4x2, small 130dp on a 2x2; a 2x2 with 12dp padding gives 50dp buttons.
- Every button's hit frame is at least 48dp tall and wide.
- Button columns: Sleep 1.3fr, the other three 0.9fr (76dp and 53dp on a 4x2).
- Type: name 15 display face, number 15 weight 800, labels 11, button labels 12; small clock digits 30sp with AM or PM at 13.
- "Asleep now" only where the status cell (`cellWidth`, a Double, never rounded) is at least `asleepNowMinWidth` 84, else "Asleep" over "since 2:40 AM".
- The widget body opens the ViewModel's `url`: `?baby=<id>&from=widget` for one baby, `?from=widget` otherwise, `?go=monthcard&baby=<id>&m=<total months>&from=widget` on a month day (F10), and `?go=sleep&baby=<id|both>&from=widget` while a noConnection or notSaved line shows, which wins over the month day (spec 6.5, 6.7 step 6).
- F10 (17 Nov, fixed: month days, nothing else). On a baby's month day (M15: `m.at <= now < m.at + 86400000`) the medium's age slot reads `header.moment.text` ("3 months today", "1 year today", "2 years today"); the small's label line reads "Robin · 3 months today" and the line under the clock gains the type ("last feed · Dad", or "last feed"); twins share one line ("Robin and Wren · 3 months today") only when both have the same unit and n, else the one baby who has it, else nothing. Honey ink, `WColors.feedInk` (#895D24 day, #E0A655 night), after a small star that TalkBack skips (it reads `header.moment.a11y`, "Robin is 3 months old today"). Times, statuses and buttons never move. Months 1 to 11 and 13 to 23, month 12 as "1 year today", then once a year. Home screen only, which every Android widget is. Nothing while loss holding applies (the snapshot's `moments` is []). Free. The body opens `?go=monthcard&baby=<id>&m=<total months>&from=widget` (12 for "1 year today"; twins: the first baby with it). Kotlin never computes a month day (contract note 6). Not built: the 6 October takeover card ("Robin is 3 months old today" with "Make a card"), marked firsts, comparisons, streaks.
- No ago line on Android; an anchor older than `dayRuleMs` 72000000 shows its day ("Yesterday", the weekday, else the date).
- Over `staleMs` 21600000 the statuses hide and the widget reads "Open Cubby to catch up."
- A nap past `napAskMs` 43200000 without an ack younger than `ackFreshMs` 21600000, or past `napMaxMs` 86400000, opens `sleepfix` and never writes in place.
- `undoMs` 10000; `lineMs` 900000; `pendingMs` 10000 (a younger pending only dims the button, an older one shows "Checking"); `pullMinMs` 600000; `pullEveryMs` 3600000; `shortcutsMax` 4; `byMax` 12; `nameMax` 20.
- A start intent omits `starts`; a stop or undo carries, per baby, the start the widget displayed.
- The fourth slot always wears the quiet (note) kind; at night every opens-Cubby button gets a 1dp stroke in its category hue; the solid button's text is `--on-sleep` (#1A1614 at night); "not yet" is `--ink-soft`.
- Providers: `widgetCategory="home_screen"` only, `widgetFeatures="reconfigurable|configuration_optional"`, small is its own provider, layouts chosen by width and height (SizeMode.Responsive, F8).
- Refresh: updatePeriodMillis floor 30 min (WorkManager 15); no relative time is ever drawn as a fixed string.
- Shared container: SharedPreferences `cubby_widget`, keys `appSnapshot` (app only), `napState` (widget only), `pullSnapshot` (widget only), each a JSON string (2.5), plus P5's `pokedAt` and `pullTriedAt` (JSON numbers); every clear removes all five.
- Token: prefs `cubby_widget_secure` under Keystore alias `cubby_widget_key`; deviceId in `noBackupFilesDir/cubby_device_id`; undecryptable means signed out; `clear()` and `revokeToken()` drop the token locally first, then POST /api/widget/revoke with `Bearer <t>` (P4 note 7).
- Backup: dataExtractionRules and fullBackupContent exclude the widget prefs and the token.
- Shortcuts: dynamic only, ids `go-<go>`, at most 4, labels from QUICK_ACTIONS; no shortcuts.xml and no `android.app.shortcuts` meta-data, ever.
- Plugin `CubbyWidget` = `com.littlecubby.app.CubbyWidgetPlugin`, registered in MainActivity before super.onCreate (2.6).
- Package `com.littlecubby.app.widget`: CubbyMediumWidget + CubbyMediumReceiver, CubbySmallWidget + CubbySmallReceiver, CubbyWidgetConfigActivity, NapActionCallback (the only ActionCallback that writes), CubbyPokeService (2.6).
- Silent push: data `{"cubby":"widget-refresh"}`, android priority NORMAL, collapse_key `cubby-widget`, ttl 600s, no notification block; the receiver updates the widgets (2.9).
- Versions: versionName `YYYY.W.R` (cap_ios_build.sh:69's rule); versionCode `YYYY*10000 + W*100 + R`; `~/.android-keys/cubby-upload.jks`, `keystore.properties`, alias `cubby-upload` (2.6).
- No `*.jks`, `*.keystore` or `keystore.properties` is ever committed (spec 6.12 key-file guard).
- Every glass string lives in docs/widgets/widget-copy.json; hand-written Kotlin and XML hold no user-facing literal; no em-dash, no "Pro", sentence case.
- Never on glass: illness detail, temperatures, medicine, mood, photos, anything Pro; no Android lock-screen widget.
- Twins default to Both; Health is always per baby; siblings set to Both open every button on the active baby (spec 6.4).
- No third-party SDK on a native surface: no Meta class in the AAB, no analytics library (D8).

## Review Focus

1. A phone set to Arabic (ar-AE) or Hindi (hi-IN), or to 24-hour time: every clock, age, day and month day must read as Home does ("2:10 AM", "3 months today", Latin digits; fmtClock is 12-hour for everyone). Test: Task 5, WidgetGoldenTest re-runs every fixture, the moment cases included, under both locales.
2. A time zone or clock change while the widget sits untouched (travel, the night the clocks go forward): times and the next redraw follow at once. Tests: Task 5's daylight-saving case and nextChangeAt property; Task 8's WidgetReceiverTest sends TIMEZONE_CHANGED and TIME_SET.
3. Two taps at once (a double tap, or the Both medium and a small widget for one twin): never two writes, never a lost napState. Tests: Task 6's 100 concurrent updateNap calls; Task 7's overlapping and disjoint taps.
4. A tap whose answer never comes (a timeout after sending, the process killed mid-request): never "didn't save", the pending survives a new process, and a state call settles it. Test: Task 7's unknown-outcome and fresh-process cases.
5. A phone restored from backup, or the app reinstalled: no token, no snapshot, Keystore key gone; the widget reads signed out or "Sleep ↗", never zeros and never the old family. Tests: Task 6's undecryptable-token case, Task 8's signed-out render, Task 4's backup-rules check.

---

### Task 1: A signing key can never be committed

**Files:**
- Modify: .githooks/pre-commit:25-42 (new block after the syntax gate, before the cacheable block, so before the early `exit 0` at :55)
- Modify: .gitignore:38-40 (three patterns under "NEVER commit signing keys")
- Modify: tools/hooks_check.js:129-134 (static assertions), :139-169 (self-test)
- Modify: tools/deploy_exclusion_check.js:72-75 (KEY_NAME), :289-315 (one more plant)
- Test: gates `hooks` (tools/hooks_check.js --self-test) and `deploy-excl` (tools/deploy_exclusion_check.js --self-test)

**Interfaces:**
- Consumes: nothing.
- Produces: pre-commit exits 1 for any staged path matching `(^|/)[^/]+\.(jks|keystore)$` or `(^|/)keystore\.properties$` (case-insensitive), naming each path; tools/hooks_check.js `keyGuard(body: string) -> boolean` (the block is present and sits before `[ -z "$cacheable" ] && exit 0`).

- [ ] **Step 1: Write the failing test.** The key-guard assertions read this tree's own hook, `path.join(root, '.githooks/pre-commit')` with root from `git rev-parse --show-toplevel` (:113), not the resolved path: in a worktree core.hooksPath names the main checkout's copy (:49-54), which only changes after merge. Static, beside :129-134:
```js
ok('pre-commit refuses a staged *.jks, *.keystore or keystore.properties', keyGuard(treeHook), treeHookPath);
ok('and that refusal sits before its early exit, so a commit with no app assets still meets it', keyGuard(treeHook));
```
Self-test (:139-169): delete every `GIT_*` env var first (as change_test_check.js:135 does), then in a throwaway repo under os.tmpdir(): stage `release/cubby-upload.jks` and run `sh <treeHookPath>` there: exit 1 and stdout contains `release/cubby-upload.jks`; a second repo staging `android/keystore.properties`: exit 1; a third staging only `README.md`: exit 0. A mutant string with the guard block moved below the early-exit line: `keyGuard(mutant) === false`, and run as a file in the `.jks` repo it exits 0 (the order is the whole point). In tools/deploy_exclusion_check.js's key plants (:289-315), add `'unlisted-secrets/keystore.properties': 'storePassword=selftest'`, assert it is flagged, and change "nothing else is flagged" to `open.length === 3`.
- [ ] **Step 2: Run it and see it fail.** `node tools/gates.js --only=hooks` → `FAIL pre-commit refuses a staged *.jks...`, the behavioural lines FAIL, `HOOKS: FAIL`. `node tools/gates.js --only=deploy-excl` → `FAIL ... keystore.properties ...` and the count line FAIL.
- [ ] **Step 3: Implement.** Pre-commit block: filter `$staged` with `grep -iE` for the two patterns; if any, print each path, say keys live in `~/.android-keys/` and how to unstage (`git restore --staged <path>`), and `exit 1`. Unlike the other blocks it never suggests `--no-verify`. .gitignore after :40: `*.jks`, `*.keystore`, `keystore.properties` with a one-line reason. KEY_NAME gains `/^keystore\.properties$/i`.
- [ ] **Step 4: Run and pass.** `node tools/gates.js --only=hooks` → `HOOKS: PASS`; `node tools/gates.js --only=deploy-excl` → every line ok, PASS.
- [ ] **Step 5: Commit.** `git commit -o .githooks/pre-commit .gitignore tools/hooks_check.js tools/deploy_exclusion_check.js -m "A signing key can never be committed: pre-commit refuses keystores and keystore.properties before anything else" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 2: An Android shell this repo can rebuild

**Files:**
- Create: native-android/build.gradle, native-android/variables.gradle, native-android/app/build.gradle, native-android/app/src/main/AndroidManifest.xml, native-android/app/src/main/java/com/littlecubby/app/MainActivity.java, native-android/app/src/main/res/xml/cubby_backup_rules.xml, native-android/app/src/main/res/xml/cubby_data_extraction_rules.xml
- Create: tools/cap_android_configure.js; test/android-configure.test.js
- Modify: tools/gates.js after :279 (a new `TREE.push(` block for the Android gates, kept apart from TREE as the wiring block :251-279 is)
- Modify, only if absent: .gitignore (`/node_modules`: a worktree's link to the main checkout's node_modules is a file, which `node_modules/` at :10 never matches, the trap :12-13 describe). P3's Task 3 adds the same line beside `/native-build`, so this task normally changes nothing here.
- Read (scaffold): android/build.gradle:1-29, android/variables.gradle:1-16, android/app/build.gradle:1-54, android/app/capacitor.build.gradle:11-17, android/app/src/main/AndroidManifest.xml:1-41, android/app/src/main/java/com/littlecubby/app/MainActivity.java:1-5

**Interfaces:**
- Consumes: P1's native-android/app/src/main/java/com/littlecubby/app/widget/Generated.kt and native-android/app/src/main/res/values/widget_strings.xml (copied like any source); P1's `native-android` lines in .assetsignore and deploy_exclusion_check.js; the main checkout's gitignored package.json and node_modules.
- Produces: `node tools/cap_android_configure.js [--root <dir>]` (default root: the repo holding the script; sources always from that repo's native-android/); `module.exports.configure({ src: string, root: string }) -> { wrote: string[] }`, throwing an Error whose message names the file on any refusal. OWNED = `build.gradle`, `variables.gradle`, `app/build.gradle`, `app/src/main/AndroidManifest.xml`, `app/src/main/java/com/littlecubby/app/MainActivity.java`, each tracked copy carrying the header `Copied into android/ by tools/cap_android_configure.js from native-android/. Edit it there.` (line 1, or line 2 after an XML declaration). Gradle properties `cubbyVersionName`, `cubbyVersionCode`. Release signing from `~/.android-keys/keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`). variables.gradle keeps the scaffold's 15 values and adds `kotlinVersion = '2.2.20'`, `glanceVersion = '1.1.1'`, `workVersion = '2.10.0'`, `coroutinesVersion = '1.9.0'`, `robolectricVersion = '4.14.1'`, `androidxTestCoreVersion = '1.6.1'`, `firebaseMessagingVersion = '25.0.1'`, `rgcfaIncludeGoogle = true`, `rgcfaIncludeFacebook = false`. If a pin does not resolve from google() or mavenCentral(), take the newest patch of the same minor and say so in a comment beside it.

- [ ] **Step 0: Toolchain and a worktree-local shell.** FOUNDER STEP: a yes before installing (about 4 GB of downloads, and the Android SDK licences are his to accept): `brew install --cask temurin@21 android-commandlinetools`; `sdkmanager --sdk_root="$HOME/Library/Android/sdk" "platform-tools" "platforms;android-36" "build-tools;36.0.0" "emulator" "system-images;android-36;google_apis_playstore;arm64-v8a"`; `sdkmanager --sdk_root="$HOME/Library/Android/sdk" --licenses` (he answers); `avdmanager create avd -n cubby-36 -k "system-images;android-36;google_apis_playstore;arm64-v8a" -d pixel_8`. Then check `"$(/usr/libexec/java_home -v 21)/bin/java" -version` prints 21 (this Mac has only JDK 26 today, which Gradle 8.14 cannot run on). In the worktree: `ln -s "$(git rev-parse --git-common-dir)/../package.json" package.json`, `ln -s "$(git rev-parse --git-common-dir)/../node_modules" node_modules`, `npx --no-install cap add android`, `mkdir -p native-build && cp ~/.android-keys/google-services.json native-build/` (where the founder saved it on 17 Nov; configure reads only native-build/, roadmap section 3). `git check-ignore -v package.json node_modules android native-build` must name a rule for each (node_modules by the `/node_modules` line, P3 Task 3's or Step 3's), and `git status --short` must list none of them.
- [ ] **Step 1: Write the failing test.** test/android-configure.test.js builds a temp root holding a fake scaffold whose files carry the real scaffold markers (below), a `capacitor.build.gradle` naming the six plugin projects, Capacitor's `res/values/strings.xml`, and `<tmp>/keys/google-services.json` = `{}` with `CUBBY_ANDROID_KEYS=<tmp>/keys`, then calls `configure({ src: <this repo>, root: tmp })`:
```js
ok('every file under native-android/ lands byte-equal at android/<same path>', allEqual);
ok('Capacitor\'s strings.xml is untouched (the manifest needs app_name and title_activity_main)', same(stringsBefore, stringsAfter));
ok('a second run writes nothing', second.wrote.length === 0, second.wrote);
ok('no file that existed before is gone afterwards', missing.length === 0, missing);
ok('google-services.json is copied in from the keys folder', same(path.join(process.env.CUBBY_ANDROID_KEYS, 'google-services.json'), 'android/app/google-services.json'));   // the test sets CUBBY_ANDROID_KEYS to <temp>/keys
```
Refusals, each in a fresh temp root, each asserting the thrown message names the path: no google-services.json in the keys folder; a scaffold build.gradle naming `gradle:8.14.0` ("Capacitor's template moved"); an OWNED file that is neither scaffold nor ours (a hand-edited app/build.gradle); a capacitor.build.gradle still naming `:capacitor-push-notifications` (the July shell does, scaffold capacitor.build.gradle:13). Companion plant: a temp copy of native-android/ with an added `app/src/main/res/values/strings.xml` must be refused. Prints `ANDROID-CONFIGURE: PASS|FAIL`. Wire it: `{ name: 'android-configure', cmd: ['node', 'test/android-configure.test.js'] }`.
- [ ] **Step 2: Run it and see it fail.** `node tools/gates.js --only=android-configure` → `Cannot find module '../tools/cap_android_configure.js'`, ANDROID-CONFIGURE: FAIL. Later, with configure written but the strings.xml refusal left out, the companion plant line goes FAIL; watch that once.
- [ ] **Step 3: Implement.** Decisions the code must follow:
  - Copy rule: native-android/<rel> → android/<rel>, written only when the bytes differ; nothing is ever deleted, so the scaffold's ExampleUnitTest.java and anything else stays.
  - An OWNED file is replaced only when it is ours (the header) or the scaffold (all its markers). Scaffold markers, exact: build.gradle `classpath 'com.android.tools.build:gradle:8.13.0'` (scaffold :10); variables.gradle `cordovaAndroidVersion = '14.0.1'` (:15); app/build.gradle `if (servicesJSON.text)` (:49); AndroidManifest.xml `androidx.core.content.FileProvider` (:28); MainActivity.java `public class MainActivity extends BridgeActivity {}` (:5). A scaffold build.gradle with any other AGP version is refused.
  - MainActivity stays Java so configure overwrites the scaffold's file rather than removing it; the Kotlin plugin class is registered from Java (Task 6).
  - The tracked app/build.gradle applies `com.android.application`, `org.jetbrains.kotlin.android`, `org.jetbrains.kotlin.plugin.compose`, and at the end `com.google.gms.google-services` unconditionally, replacing the try/catch that logs at info level (scaffold :47-54) so a missing file fails the build. versionCode and versionName read `cubbyVersionCode` and `cubbyVersionName` (debug defaults 1 and "0.0.0-dev"); a task-graph guard refuses `bundleRelease` and `assembleRelease` with a GradleException naming what is missing when either property or keystore.properties is absent. `buildFeatures.compose true`, `kotlinOptions.jvmTarget '21'`, `testOptions.unitTests.includeAndroidResources true`, release `signingConfig signingConfigs.release`, assigned only when keystore.properties exists so `testReleaseUnitTest` runs without the keys (the guard covers packaging). Dependencies: the scaffold's, plus glance-appwidget, work-runtime-ktx, kotlinx-coroutines-android, firebase-messaging (the plugin keeps it `implementation`, so the app needs its own), and for tests junit, robolectric, androidx.test:core, glance-appwidget-testing, work-testing, kotlinx-coroutines-test.
  - The tracked root build.gradle adds `kotlin-gradle-plugin:$kotlinVersion` and `compose-compiler-gradle-plugin:$kotlinVersion` to the buildscript classpath beside AGP 8.13.0 and google-services 4.4.4.
  - The tracked manifest is the scaffold's plus `xmlns:tools`, `android:dataExtractionRules="@xml/cubby_data_extraction_rules"` and `android:fullBackupContent="@xml/cubby_backup_rules"` on application, and on MainActivity an `android:autoVerify="true"` VIEW filter (DEFAULT, BROWSABLE; https; host little-cubby.com; `pathPrefix="/app/"` and `path="/__/auth/action"`, the two components the AASA serves, worker.js:3259-3263).
  - Both backup files exclude `sharedpref` `cubby_widget.xml`, `sharedpref` `cubby_widget_secure.xml` and `file` `datastore/` (Glance's per-widget state); the extraction rules do it under both `cloud-backup` and `device-transfer`.
  - configure also copies `${CUBBY_ANDROID_KEYS:-~/.android-keys}/google-services.json` to android/app/google-services.json (founder correction 17 Nov: the file already lives in ~/.android-keys beside the upload key, and the repo folder sits in ~/Downloads, which nothing writes to), refusing with the Firebase console path when it is missing, and refuses unless android/app/capacitor.build.gradle names `:capacitor-firebase-authentication`, `:capacitor-firebase-messaging`, `:capacitor-browser`, `:capacitor-share`, `:capacitor-filesystem`, `:capacitor-haptics` and not `:capacitor-push-notifications` ("run npx --no-install cap sync android first").
  - .gitignore: only when `grep -qx '/node_modules' .gitignore` finds nothing, add `/node_modules` under the :10-14 block with the reason :12-13 give. Never a second copy of P3 Task 3's line.
  - If `:app:assembleDebug` fails because of the Kotlin or Compose plugin and the pins cannot fix it, stop and ask; RemoteViews is the spec's fallback, and the reason goes into this plan first.
- [ ] **Step 4: Run and pass.** `node tools/gates.js --only=android-configure` → ANDROID-CONFIGURE: PASS. On this Mac: `npx --no-install cap sync android && node tools/cap_android_configure.js && (cd android && JAVA_HOME="$(/usr/libexec/java_home -v 21)" ./gradlew --no-daemon :app:assembleDebug)` → `BUILD SUCCESSFUL`. Then `node tools/gates.js --only=test-wiring` → PASS (the new test is wired).
- [ ] **Step 5: Commit.** `git add native-android/build.gradle native-android/variables.gradle native-android/app/build.gradle native-android/app/src/main/AndroidManifest.xml native-android/app/src/main/java/com/littlecubby/app/MainActivity.java native-android/app/src/main/res/xml tools/cap_android_configure.js test/android-configure.test.js && git commit -o native-android tools/cap_android_configure.js test/android-configure.test.js tools/gates.js -m "Android: a shell this repo can rebuild, with Kotlin, App Links, backup exclusions and sign-in that fails loudly without its config" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"` (add `.gitignore` to the `-o` paths only if Step 3 changed it).

---

### Task 3: App Links: the Worker serves assetlinks.json

**Files:**
- Modify: worker.js:3247-3268 (a `/.well-known/assetlinks.json` branch right after the AASA branch)
- Modify: wrangler.toml:29-45 ([vars] gains `ANDROID_CERT_SHA256 = ""` with a comment: public fingerprints, not a secret)
- Modify: test/worker-routes.test.js (new section 10 before the cleanup at :392)
- Test: gate `worker-routes`

**Interfaces:**
- Consumes: nothing from other plans.
- Produces: `assetLinks(env) -> Response`. `env.ANDROID_CERT_SHA256` is a comma-separated list, each entry `^([0-9A-F]{2}:){31}[0-9A-F]{2}$`. No entries, or any malformed entry: 404. Otherwise 200, `content-type: application/json`, `cache-control: public, max-age=3600`, no redirect, body `[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"com.littlecubby.app","sha256_cert_fingerprints":[...in the order given]}}]`. Non-GET: 405.

- [ ] **Step 1: Write the failing test.** Section 10 drives the real fetch handler with `call(w, 'GET', '/.well-known/assetlinks.json', undefined, env)`:
```js
ok('unset: 404, never an empty or placeholder file', r0.status === 404);
ok('one valid fingerprint: 200 with exactly the Digital Asset Links shape', r1.status === 200 && same(r1.body, expected([FP1])));
ok('two: both, in order', same(r2.body, expected([FP1, FP2])));
ok('one malformed entry (lowercase, or 31 pairs) refuses the whole file: 404', rBad.status === 404 && rShort.status === 404);
ok('the companion: AASA still answers 200 with applinks', aasa.status === 200 && aasa.body.applinks);
```
plus a content-type check on the 200 (read through a raw `w.fetch`, since `call` drops headers).
- [ ] **Step 2: Run it and see it fail.** `node tools/gates.js --only=worker-routes` → the 200 lines FAIL (today the path falls through to assets and 404s), WORKER-ROUTES: FAIL. Then, with the route written to answer 200 and `[]` when unset, watch the first line FAIL once.
- [ ] **Step 3: Implement** `assetLinks(env)` and the branch, per the contract above.
- [ ] **Step 4: Run and pass.** `node tools/gates.js --only=worker-routes` → WORKER-ROUTES: PASS.
- [ ] **Step 5: Commit.** `git commit -o worker.js wrangler.toml test/worker-routes.test.js -m "App Links: the Worker serves assetlinks.json once the signing fingerprints are set, and nothing before" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

FOUNDER STEP: the fingerprints. The upload key's comes from `keytool -printcert -jarfile android/app/build/outputs/bundle/release/app-release.aab` after Task 4's first release build; the Play app signing key's appears in Play Console (App integrity) after the first upload. A commit sets `ANDROID_CERT_SHA256 = "<upload>,<play>"`; the push that deploys it is his (worker.js is an emulator-tier trigger, change_test_check.js:41).

---

### Task 4: The release build and its Mac-only gates

**Files:**
- Create: tools/cap_android_build.sh, tools/android_widget_check.sh
- Modify: tools/android_parity_check.js:1-100 (header, :36-52 google-services, :54-60 signing, :79-88 versions, new modes)
- Modify: tools/test_wiring_check.js:34-46 (ALLOW, CANDIDATE_RES), :48-61 (listCandidates reads one more directory), :131-170 (self-test)
- Modify: tools/change_test_check.js:38-40 (PRODUCT, TESTISH), :165-175 (self-test cases)
- Modify: tools/gates.js (Task 2's Android block gains `android-parity`)
- Modify: docs/TESTING.md:58-78 (the ALLOW paragraph, "five files"), :222-235 (watched-red rows); OPERATIONS.md:33
- Test: gates `android-parity`, `test-wiring`, `change-test`; `bash tools/android_widget_check.sh --self-test`

**Interfaces:**
- Consumes: Task 2's configure and Gradle properties; P1's `node tools/widget_gen.js --check`.
- Produces:
  - `bash tools/cap_android_build.sh` (release: sync, configure, unit tests, AAB and APK, every Mac-only gate) or `--unit [Class]` (configure, `:app:testReleaseUnitTest` for one class or all, then the JUnit check). Env `CUBBY_REL` (default 1, refused above 99). `VER="$(date +%G).$(date +%V | sed 's/^0//').${CUBBY_REL:-1}"` (cap_ios_build.sh:69), `CODE = Y*10000 + W*100 + R`. Preflight refuses, naming the fix: JDK 21 must run (`"$JAVA_HOME/bin/java" -version`, never `command -v java`), `$ANDROID_HOME/platform-tools/adb` present, `${CUBBY_ANDROID_KEYS:-~/.android-keys}/google-services.json`, and for a release `~/.android-keys/keystore.properties`. After a release it prints the AAB path; upload is the founder's.
  - `bash tools/android_widget_check.sh [--self-test]`; env `CUBBY_ANDROID_DIR` (default `$ROOT/android`), `CUBBY_CHECK=unit|release`, `CUBBY_VERSION_NAME`, `CUBBY_VERSION_CODE`, `CUBBY_AVD` (default `cubby-36`), `CUBBY_SMOKE_SECS` (12), `CUBBY_SMOKE_OUT` (`$TMPDIR/cubby-android-smoke`); array `EXPECTED_TESTS=()` of test file names (`WidgetGoldenTest.kt`), which each later task appends to and which is what makes this script the ranBy of each Kotlin test (roadmap 2.10, contract note 1); last line `ANDROID-WIDGET-CHECK: PASS|FAIL`.
  - tools/android_parity_check.js: `node tools/android_parity_check.js [baseUrl]` as today, `--release` (adds the built-shell lines), `--self-test` (plants only; last line `ANDROID-PARITY-SELFTEST: PASS|FAIL`); exported `judge(root, { base: string|null, release: boolean, version: { name, code } | null }) -> { pass, fail }`.

- [ ] **Step 1: Write the failing tests.**
  - android_parity_check.js `--self-test`, each plant a temp root, base null (no network): (1) no android/app/build.gradle → the versions line must FAIL (today :80-81 passes on an empty string: the false pass); (2) scaffold `versionCode 1` and `versionName "1.0"` → FAIL; (3) the conditional `if (servicesJSON.text)` apply → FAIL; (4) a release block with no signingConfig → FAIL; (5) capacitor.build.gradle naming `:capacitor-push-notifications` → FAIL; (6) native-android/ copied as android/ plus a six-plugin capacitor.build.gradle and a package.json naming both @capacitor-firebase plugins → every static line PASS. Wire `{ name: 'android-parity', cmd: ['node', 'tools/android_parity_check.js', '--self-test'] }`.
  - test_wiring_check.js self-test: plant an unexcused `native-android/app/src/test/java/com/littlecubby/app/widget/OrphanTest.kt` → "is run by nothing"; ALLOW it with a ranBy file that never names it → the ranBy failure; a `Helper.kt` beside it is not a candidate.
  - change_test_check.js self-test: a commit touching only `native-android/app/src/main/java/x/A.kt` → RED; adding `native-android/app/src/test/java/x/ATest.kt` → GREEN.
  - android_widget_check.sh `--self-test` plants, in a temp dir, one bad input per release check (below) plus one good set; each bad one must FAIL and the good one PASS.
- [ ] **Step 2: Run them and see them fail.** `node tools/gates.js --only=android-parity` → plant (1) and (3) report "expected FAIL, got ok", ANDROID-PARITY-SELFTEST: FAIL. `node tools/gates.js --only=test-wiring` → the Kotlin plant is not seen, FAIL. `node tools/gates.js --only=change-test` → the native-android line FAIL. For android_widget_check.sh, once written, make its shortcuts check return success unconditionally and watch `--self-test` FAIL on that plant; restore.
- [ ] **Step 3: Implement.**
  - android_parity_check.js: :42-50 become "google-services.json is present and app/build.gradle applies the plugin with no `servicesJSON` guard"; :55-60 require a non-empty gradle file; :79-84 FAIL when android/app/build.gradle is missing and pass only when versionCode and versionName read `cubbyVersionCode` and `cubbyVersionName`; a new line asserts the six plugin projects and no push-notifications; `--release` adds: the merged manifest's versionName equals today's CalVer with CUBBY_REL and its versionCode equals the formula, and the live assetlinks.json lists the SHA-256 that `keytool -printcert -jarfile <aab>` reports for the AAB's signer. Its header says what each mode proves.
  - android_widget_check.sh release checks, each a function its self-test feeds: (a) a merged manifest is found (`find "$DIR/app/build/intermediates" -path '*merged_manifest*' -path '*release*' -name AndroidManifest.xml`), else FAIL as a check that graded nothing; (b) MainActivity's autoVerify VIEW filter with https, little-cubby.com, `/app/` and `/__/auth/action`; (c) application names both backup attributes and both XMLs exclude the three paths in every section; (d) no `android.app.shortcuts` meta-data and no `base/res/xml/shortcuts.xml` in the AAB; (e) versionName and versionCode equal CUBBY_VERSION_NAME and CUBBY_VERSION_CODE; (f) zero `Lcom/facebook/` strings across `base/dex/*.dex` (as cap_ios_build.sh:84-86 does for fbsdk); (g) `jarsigner -verify` passes on the AAB and the APK; (h) for each EXPECTED_TESTS file `<Class>.kt` a `TEST-com.littlecubby.app.widget.<Class>.xml` under `app/build/test-results/testReleaseUnitTest/` with tests > 0, failures 0, errors 0, and no TEST-*.xml anywhere with a failure; (i) launch smoke: boot `$CUBBY_AVD` headless, install the release APK, start MainActivity, after CUBBY_SMOKE_SECS the pid lives and logcat has no `FATAL EXCEPTION` for the package, `screencap` to `$CUBBY_SMOKE_OUT/launch.png` (then Read the PNG), then a VIEW intent for `https://little-cubby.com/app/?go=feed&from=widget` explicit to MainActivity leaves it alive; `adb emu kill` after. `CUBBY_CHECK=unit` runs (h) only. XML parsing is `python3 - <<'PY'` with xml.etree.
  - cap_android_build.sh order: preflight; `node tools/widget_gen.js --check`; release only: `npx --no-install cap sync android`; `node tools/cap_android_configure.js`; Gradle with `-PcubbyVersionName=$VER -PcubbyVersionCode=$CODE`: `:app:testReleaseUnitTest` then `:app:bundleRelease :app:assembleRelease`; `bash tools/android_widget_check.sh --self-test`, then the real check; `node tools/android_parity_check.js --release`. `set -euo pipefail`, every red aborts.
  - test_wiring_check.js: drop the android_parity_check ALLOW entry (:39-40); CANDIDATE_RES gains the Kotlin pattern of contract note 1 and listCandidates reads `native-android/app/src/test/java/com/littlecubby/app/widget` (beside P3's `tools/*_check.sh`, `tools/*_smoke.sh` and `native-ios/Tests`, which this task does not touch); ALLOW gains `'tools/android_widget_check.sh': { reason: 'Mac-only: needs the built Android shell, the SDK, JDK 21 and an emulator', ranBy: 'tools/cap_android_build.sh' }`. Every later task that creates a Kotlin test adds `{ reason: 'Mac-only: a Robolectric test run by Gradle, needs JDK 21 and the Android SDK', ranBy: 'tools/android_widget_check.sh' }` for it in the same commit.
  - change_test_check.js: PRODUCT gains `/^native-android\//`, TESTISH gains `/^native-android\/app\/src\/test\//` (beside P3's native-ios lines).
  - docs/TESTING.md: the ALLOW paragraph lists android_widget_check.sh (and drops the parity check); a short "Mac-only Android gates" note names cap_android_build.sh, `--unit`, and what each check proves; watched-red rows for android-configure, android-parity, hooks (key guard) and android_widget_check.sh. OPERATIONS.md:33: the parity check's comment now says plain mode checks production's App Links and the shell, and `--release` runs inside cap_android_build.sh.
- [ ] **Step 4: Run and pass.** `node tools/gates.js --only=android,test-wiring,change-test` → ANDROID-CONFIGURE, ANDROID-PARITY-SELFTEST, TEST-WIRING, CHANGE-TEST: PASS. `bash tools/android_widget_check.sh --self-test` → ANDROID-WIDGET-CHECK: PASS. `bash tools/cap_android_build.sh --unit` → BUILD SUCCESSFUL, ANDROID-WIDGET-CHECK: PASS (no expected classes yet). A full `bash tools/cap_android_build.sh` stops at preflight naming `~/.android-keys/keystore.properties` until the founder step below; after it, it stops at the parity line for assetlinks until Task 3's values are deployed.
- [ ] **Step 5: Commit.** `git add tools/cap_android_build.sh tools/android_widget_check.sh && git commit -o tools/cap_android_build.sh tools/android_widget_check.sh tools/android_parity_check.js tools/test_wiring_check.js tools/change_test_check.js tools/gates.js docs/TESTING.md OPERATIONS.md -m "Android release build: one script to a signed AAB, with Mac-only gates that refuse an unsigned, unlinked or untested build" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

FOUNDER STEP: write `~/.android-keys/keystore.properties` (storeFile pointing at `~/.android-keys/cubby-upload.jks`, storePassword, keyAlias `cubby-upload`, keyPassword) and back the keystore up; add the upload key's SHA-1 and SHA-256 (`cd android && ./gradlew :app:signingReport`, variant release) to the Firebase Android app `com.littlecubby.app`, DONE 17 Nov for the upload key: both fingerprints are in Firebase and the refreshed google-services.json is at ~/.android-keys/google-services.json, where configure reads it. Still to come: the Play app-signing key fingerprints after the first upload, then download it again to the same place.

---

### Task 5: The Kotlin model, held to the fixtures

**Files:**
- Create: native-android/app/src/main/java/com/littlecubby/app/widget/ModelTypes.kt, WidgetModel.kt, Clock.kt, Words.kt
- Create: native-android/app/src/test/java/com/littlecubby/app/widget/WidgetGoldenTest.kt
- Modify: tools/cap_android_configure.js (also copies docs/widgets/widget-fixtures.json and docs/widgets/widget-copy.json to android/app/src/test/resources/, the second for Words and Task 7's `napCases`), test/android-configure.test.js (asserts both copies)
- Modify: tools/widget_gen.js (P1's Kotlin emitter: `WCopy.byKey`, contract note 3), native-android/app/src/main/java/com/littlecubby/app/widget/Generated.kt (regenerated)
- Modify: docs/widgets/widget-copy.json `cases` (Android cases, P1's file), docs/widgets/widget-fixtures.json (regenerated)
- Modify: tools/android_widget_check.sh (`EXPECTED_TESTS+=(WidgetGoldenTest.kt)`), tools/test_wiring_check.js (its ALLOW entry)

**Interfaces:**
- Consumes: P1 tools/widget_model.js `renderModel(input: FixtureInput) -> ViewModel` (the reference, ported function for function: P1's rules M1-M15 with M13's `pendingMs` and M15's month day, the rows' `day` and `a11y`, `header.moment`, the top-level `url` with M12's monthcard link, and P5 Task 7's field-by-field merge for M3, which ignores the pull unless appSnapshot.state is 'ok', lets a pull baby's `healthOpen` be null and draws the app's `moments` whichever source is newer, but [] when the pull is the newer source, has the baby and its list is [], P5 note 8); SnapshotBaby and PullSnapshot baby `moments: [{ at, unit, n }]`, read as data (contract note 6: no Kotlin monthMoments); Generated.kt `WCopy` (resource ids), `WCopy.fill(s, args)`, `WRules`, `WDefaults`, `WActions.all` (Android's entries only), `WSnapshot.versions`; fixtures `{ source, tz: "UTC", fixtures: [{ name, input, expect }] }` (roadmap 2.3); `node tools/widget_gen.js` and `--check`; gate `widget-parity`.
- Produces:
```kotlin
data class WidgetConfig(val baby: String?, val button: String?, val first: String?, val second: String?)
data class ModelInput(val platform: String, val phase: String, val family: String, val config: WidgetConfig,
    val cellWidth: Double, val now: Long, val token: Boolean, val app: JSONObject?, val nap: JSONObject?,
    val pull: JSONObject?) { companion object { fun fromJson(o: JSONObject): ModelInput } }  // cellWidth via optDouble, never rounded
data class HeaderMoment(val text: String, val a11y: String)   // header.moment (F10, M15), P3's Swift name; null on every other day
data class ViewModel(/* 2.3 field for field: mode, message, header (name, age, fresh, ask, moment: HeaderMoment?), rows (with day, a11y), buttons, line, url */) { fun toJson(): JSONObject }
object WidgetModel { fun render(input: ModelInput, res: Resources): ViewModel; fun nextChangeAt(input: ModelInput): Long? }
// Generated.kt, inside object WCopy: val byKey: Map<String, Int> = mapOf("status.lastFeed" to R.string.w_status_last_feed, ...)
object Words { fun of(res: Resources, key: String): String }   // res.getString(WCopy.byKey[key]); IllegalArgumentException on an unknown key
object Clock { fun fmtClock(ms: Long, res: Resources): String } // index.html:2189-2194: default zone, Latin digits, time.am / time.pm
const val ANDROID_PHASE = "B"                                   // Android ships A and B together
```

- [ ] **Step 1: Write the failing test.** First, for every medium or small case in widget-copy.json `cases` that has no Android twin (P1 already has `android-asleep-short`), add `"<name> (android)"` with `platform: 'android'`, plus: a running nap at `cellWidth` 72 and 83.5 ("Asleep") and 84 and 146 ("Asleep now"; 83.5 is where a rounded width would cross the boundary); voice as the medium's fourth button and as the small's second; stale at `staleMs + 1`; signed out; a pending 2 s old (dim, line null) and one 15 s old (dim, "Checking"; `pendingMs` 10000); Undo live; line `noConnection` and line `notSaved`, each with a hand-written `expect.url` of `https://little-cubby.com/app/?go=sleep&baby=<its baby>&from=widget` (spec 6.5, 6.7 step 6); and an Android twin of each P5 `pull.*` case. Then the month days (F10, M15), 15 cases, all `platform: 'android'`, phase B, medium unless said. Robin is b1 and Wren b2 as in P1's table; `/app/?` stands for `https://little-cubby.com/app/?`; D = 2026-11-17, `now` N = 1794885240000 (03:14Z) unless said; Robin's `moments` = `[{ at: 1794873600000, unit: 'month', n: 3 }, { at: 1797465600000, unit: 'month', n: 4 }]` (00:00Z on D and on 17 Dec), Robin's `age` the `{ unit, n }` of the case's first moment (`{ unit: 'month', n: 3 }` here), and `by.feed` `Dad`. The three edge cases set `app.at` to `now - 60000` and each non-null `last.*` to `now - 3600000`, so nothing is stale or dated. Each hand-writes the `expect` fields named:

| Case | Input | expect |
|---|---|---|
| moment-medium (android) | as above | header.moment `{ text: '3 months today', a11y: 'Robin is 3 months old today' }`; url `/app/?go=monthcard&baby=b1&m=3&from=widget` |
| moment-day-before (android) | edge, now 1794873599999 | header.moment null; url `/app/?baby=b1&from=widget` |
| moment-last-ms (android) | edge, now 1794959999999 | header.moment as moment-medium |
| moment-day-after (android) | edge, now 1794960000000 | header.moment null; url `/app/?baby=b1&from=widget` |
| moment-month1 (android) | moments[0] `{ unit: 'month', n: 1 }` | `{ text: '1 month today', a11y: 'Robin is 1 month old today' }`; url `/app/?go=monthcard&baby=b1&m=1&from=widget` |
| moment-year1 (android) | moments[0] `{ unit: 'year', n: 1 }` | `{ text: '1 year today', a11y: 'Robin is 1 year old today' }`; url `/app/?go=monthcard&baby=b1&m=12&from=widget` |
| moment-years (android) | moments[0] `{ unit: 'year', n: 2 }` | `{ text: '2 years today', a11y: 'Robin is 2 years old today' }`; url `/app/?go=monthcard&baby=b1&m=24&from=widget` |
| moment-small (android) | family small | header.moment `{ text: 'Robin · 3 months today', a11y: 'Robin is 3 months old today' }`; url as moment-medium |
| moment-twins-both (android) | twins, Wren's `moments` equal Robin's | header.moment `{ text: 'Robin and Wren · 3 months today', a11y: 'Robin is 3 months old today and Wren is 3 months old today' }` (P1 note 18d); url `/app/?go=monthcard&baby=b1&m=3&from=widget` |
| moment-twins-one (android) | twins, Robin's `moments` `[{ at: 1797379200000, unit: 'month', n: 4 }, { at: 1800057600000, unit: 'month', n: 5 }]`, Wren's as Robin's above (what `monthMoments` gives at N for twins born either side of midnight, Robin 16 Aug 23:50Z and Wren 17 Aug 00:10Z; the births themselves are not fixture input) | header.moment.text `Wren · 3 months today`; url `/app/?go=monthcard&baby=b2&m=3&from=widget` |
| moment-twins-differ (android) | twins, both active on D, Robin n 3, Wren n 4 (synthetic: the rule's third branch) | header.moment null; url `/app/?from=widget` (P1 note 18c: monthcard only while `header.moment` is non-null) |
| moment-line-noconn (android) | nap.line `{ key: 'noConnection', until: N + 900000 }` | header.moment as moment-medium; url `/app/?go=sleep&baby=b1&from=widget` |
| moment-line-notsaved (android) | nap.line `{ key: 'notSaved', until: N + 900000 }` | header.moment as moment-medium; url `/app/?go=sleep&baby=b1&from=widget` |
| moment-none (android) | Robin's `moments` [] (no birth, or loss holding: the app exports []) | header.moment null; rows and buttons equal moment-medium's; url `/app/?baby=b1&from=widget` |
| moment-pull-empty (android) | plus a pull 60 s newer whose Robin carries `moments: []` beside a non-null `age` | header.moment null (a newer pull's [] hides it: a holding seeded from another phone, P5 note 8 and its `pull.momentHolding`); rows and buttons equal moment-none's; url `/app/?baby=b1&from=widget` |

Run `node tools/widget_gen.js`. WidgetGoldenTest (`@RunWith(RobolectricTestRunner::class) @Config(sdk = [34])`) reads `/widget-fixtures.json` with the default zone set to its `tz` (UTC):
```kotlin
assertTrue("android fixtures", android.size >= 33)                // 18 before F10, plus the 15 moment cases
assertEquals("moment cases", 15, android.count { it.name.startsWith("moment-") })   // an absent list never passes empty
for (f in android) assertEquals(f.name, canonical(f.expect),
    canonical(WidgetModel.render(ModelInput.fromJson(f.input), res).toJson()))
for (loc in listOf(Locale("ar", "AE"), Locale("hi", "IN"))) { Locale.setDefault(loc); /* same loop, same strings */ }  // Review Focus 1
assertEquals(androidKeys, WCopy.byKey.keys)                      // exactly this platform's keys, from /widget-copy.json
for (k in androidKeys) assertEquals(k, textOf(k), Words.of(res, k))
assertThrows(IllegalArgumentException::class.java) { Words.of(res, "no.such.key") }
for (k in MOMENT_KEYS) assertTrue(k, WCopy.byKey.containsKey(k))   // the 16: moment.*, small.moment.*, twins.moment.*, a11y.moment.* (month1, months, year1, years)
assertEquals("3 months today", WCopy.fill(Words.of(res, "moment.months"), mapOf("age" to "3")))
assertEquals("Robin · 1 year today", WCopy.fill(Words.of(res, "small.moment.year1"), mapOf("name" to "Robin")))
assertEquals("Robin and Wren · 3 months today", WCopy.fill(Words.of(res, "twins.moment.months"), mapOf("names" to "Robin and Wren", "age" to "3")))
assertEquals("Robin is 2 years old today", WCopy.fill(Words.of(res, "a11y.moment.years"), mapOf("name" to "Robin", "age" to "2")))
assertEquals(1794873600000L, WidgetModel.nextChangeAt(input("moment-day-before (android)")))   // the day starts: the moment appears
assertEquals(1794960000000L, WidgetModel.nextChangeAt(input("moment-last-ms (android)")))      // the day ends: it goes
```
`canonical` sorts keys and writes integral numbers as longs. The ar-AE and hi-IN loop runs the moment cases too, so "3 months today" keeps Latin digits. Daylight saving (Review Focus 2), a synthetic input built in the test with the zone Europe/London: feed anchors at 00:30Z and 01:30Z on 2026-03-29 render "12:30 AM" and "2:30 AM", and `nextChangeAt` at now 01:45Z is later than now. Property, every fixture: `render` is identical at now, at 16 evenly spaced instants before `nextChangeAt`, and at `nextChangeAt - 1`, and differs at `nextChangeAt`; a null `nextChangeAt` renders the same at now + 8 days.
- [ ] **Step 2: Run it and see it fail.** `bash tools/cap_android_build.sh --unit WidgetGoldenTest` → compile error, `WidgetModel` and `WCopy.byKey` unresolved, BUILD FAILED. After implementing, make `Clock.fmtClock` use `String.format("%d:%02d", ...)` with the default locale and watch the ar-AE loop FAIL; read `cellWidth` through `roundToInt()` and watch the 83.5 case FAIL by name; make M15's `now < m.at + 86400000` a `<=` and watch `moment-day-after (android)` FAIL by name; build the monthcard `m` from `n` instead of the total months and watch `moment-year1 (android)` (`m=1`, not `m=12`) and `moment-years (android)` FAIL; drop `m.at + 86400000` from `nextChangeAt` and watch the moment-last-ms line FAIL; let the twins rule ignore unit and n and watch `moment-twins-differ (android)` FAIL; let a newer pull's `moments: []` keep the app's list and watch `moment-pull-empty (android)` FAIL; restore all seven.
- [ ] **Step 3: Implement** the port. First the generator: P1's Kotlin emitter in tools/widget_gen.js adds `byKey` inside `object WCopy`, one entry per key it emits, in the file's key order. Run `node tools/gates.js --only=widget-parity` before regenerating and see `generated files are fresh` FAIL naming Generated.kt; then `node tools/widget_gen.js`. Decisions: org.json types throughout (Robolectric provides them in tests); every number through `Clock` or a `Locale.ROOT` formatter; `url` follows the JS model's rule exactly, so Task 8's views never build one; `nextChangeAt` returns the earliest of undo.until, line.until, a pending's sentAt + pendingMs (dim becomes Checking), oldest shown `at` + staleMs, each anchor + dayRuleMs, the next local midnight while any day label shows, the running nap's start + napAskMs and + napMaxMs, an ack's + ackFreshMs, and each selected baby's moment `at` and `at + 86400000`, whichever are after now, else null. M15 is ported as JS has it and nothing more: the model reads `moments` and never derives a month day from a birth date (contract note 6), so the app's monthiversary arithmetic has one home.
- [ ] **Step 4: Run and pass.** `bash tools/cap_android_build.sh --unit WidgetGoldenTest` → BUILD SUCCESSFUL, ANDROID-WIDGET-CHECK: PASS. `node tools/gates.js --only=widget-parity,android-configure` → PASS.
- [ ] **Step 5: Commit.** `git add native-android/app/src/main/java/com/littlecubby/app/widget native-android/app/src/test && git commit -o native-android tools/cap_android_configure.js test/android-configure.test.js tools/widget_gen.js docs/widgets/widget-copy.json docs/widgets/widget-fixtures.json tools/android_widget_check.sh tools/test_wiring_check.js -m "Android widgets read the family's times and month days exactly as Home does, held to the shared fixtures in every locale and time zone" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 6: Shared container, token, plugin and shortcuts

**Files:**
- Create in native-android/app/src/main/java/com/littlecubby/app/widget/: WidgetStore.kt, NapState.kt, TokenStore.kt, DeviceId.kt, WidgetApi.kt, WidgetRefresh.kt, Links.kt, Shortcuts.kt, WidgetBridge.kt
- Create: native-android/app/src/main/java/com/littlecubby/app/CubbyWidgetPlugin.kt
- Modify: native-android/app/src/main/java/com/littlecubby/app/MainActivity.java (`registerPlugin(CubbyWidgetPlugin.class)` before `super.onCreate`)
- Create tests: WidgetStoreTest.kt, TokenStoreTest.kt, WidgetBridgeTest.kt (native-android/app/src/test/java/com/littlecubby/app/widget/)
- Modify: tools/android_widget_check.sh (`EXPECTED_TESTS+=(WidgetStoreTest.kt TokenStoreTest.kt WidgetBridgeTest.kt)`), tools/test_wiring_check.js (their ALLOW entries)
- Modify: test/widget-ios-app.test.js (P3's file, gates `widget-ios-app` and `widget-ios-app-ui`): an Android section, so widget.installed (roadmap 2.11) is proven for this plugin's answer

**Interfaces:**
- Consumes: 2.5 keys and shapes, plus P5's `pokedAt` and `pullTriedAt` (its note 6: JSON numbers, removed by every clear); 2.6 plugin methods, with `clear()` also revoking (P4 note 7); P4 POST /api/widget/mint `{ idToken, hid, deviceId, platform }` → 200 `{ t, expireAt }`, 401, 403; P4 POST /api/widget/revoke with `Authorization: Bearer <t>` → 200 `{ ok:true }` for any token; P1 JS `window.cubbyWidget` (unchanged: the plugin name is the same on both platforms) and `window.__cubbyHasWidgets` (the whole answer `{ value, kinds }`); P3's `reportWidgetKinds(answer, today)` in app/native-bridge.js and test/widget-ios-app.test.js's vm harness (its section 1) and puppeteer section (its section 3); Generated `WActions.all`, `WSnapshot.versions`; Task 5 types.
- Produces:
```kotlin
class WidgetStore(ctx: Context) { fun app(): String?; fun pull(): String?; fun nap(): NapState
  fun writeApp(json: String); fun writePull(json: String?)
  fun pokedAt(): Long?; fun setPokedAt(ms: Long); fun pullTriedAt(): Long?; fun setPullTriedAt(ms: Long)
  suspend fun updateNap(f: (NapState) -> NapState): NapState   // one process-wide Mutex
  fun clearAll() }   // the five keys (appSnapshot, napState, pullSnapshot, pokedAt, pullTriedAt), nothing else
data class NapState(/* 2.5 */) { fun toJson(): String; companion object { fun parse(s: String?): NapState } }
interface TokenCipher { fun encrypt(b: ByteArray): ByteArray; fun decrypt(b: ByteArray): ByteArray }
class KeystoreCipher : TokenCipher                  // AndroidKeyStore "cubby_widget_key", AES/GCM/NoPadding, 256, iv first
class TokenStore(ctx: Context, cipher: TokenCipher = KeystoreCipher(), store: WidgetStore = WidgetStore(ctx)) {
  fun read(): String?; fun write(t: String); fun clear()        // prefs "cubby_widget_secure", key "t"
  fun take(): String? }                                          // read, then clear (iOS takeToken)
object DeviceId { fun get(ctx: Context): String }   // noBackupFilesDir/cubby_device_id, UUID v4, made once
sealed class HttpOutcome { data class Answer(val status: Int, val body: JSONObject?) : HttpOutcome()
  object NotSent : HttpOutcome(); object Unknown : HttpOutcome() }
interface Transport { suspend fun send(method: String, url: String, bearer: String?, body: JSONObject?): HttpOutcome }
object WidgetApi { const val BASE = "https://little-cubby.com"; var transport: Transport }  // HttpTransport by default
object WidgetRefresh { suspend fun all(ctx: Context) }   // APPWIDGET_UPDATE to every provider of this package
object Receivers { const val MEDIUM = "com.littlecubby.app.widget.CubbyMediumReceiver"
  const val SMALL = "com.littlecubby.app.widget.CubbySmallReceiver" }
object Links { fun view(ctx: Context, url: String): Intent }   // ACTION_VIEW, data = url, component MainActivity
object Shortcuts { fun apply(ctx: Context, keys: List<String>); fun clear(ctx: Context) }
object WidgetScope : CoroutineScope by CoroutineScope(SupervisorJob() + Dispatchers.IO)  // work that outlives a plugin call
class WidgetBridge(ctx: Context, store: WidgetStore, tokens: TokenStore, api: WidgetApi = WidgetApi,
    counts: suspend () -> Map<String, Int>, refresh: suspend () -> Unit, scope: CoroutineScope = WidgetScope) {
  fun versions(): JSONObject; suspend fun hasWidgets(): JSONObject; suspend fun setSnapshot(v: Int, json: String): JSONObject
  suspend fun clear(): JSONObject   // five keys, tokens.take(), shortcuts; then launches the revoke in scope; { ok: true } at once
  suspend fun mintToken(idToken: String, hid: String): JSONObject
  suspend fun revokeToken(): JSONObject; fun hasToken(): JSONObject }  // revokeToken awaits its request; { ok: true } either way
@CapacitorPlugin(name = "CubbyWidget") class CubbyWidgetPlugin : Plugin()   // each @PluginMethod calls WidgetBridge
```
HttpTransport, the same classes as P4's NapClient: no active network, UnknownHostException, ConnectException and NoRouteToHostException are `NotSent`; SocketTimeoutException, a reset after connecting and the 8 s wire budget (`withTimeout(8_000)`) are `Unknown`; any status is `Answer`, with `body` null unless the reply is `application/json` that parses. WidgetRefresh reaches the receivers by component name, so this task needs no widget class.

- [ ] **Step 1: Write the failing tests** (all `@RunWith(RobolectricTestRunner::class) @Config(sdk = [34])`).
  - WidgetStoreTest: prefs `cubby_widget` hold only the five keys, under exactly those names; NapState round-trips every 2.5 field (`line.key` each of the five, `undo`, `pending`); 100 concurrent `updateNap` calls each adding one baby id all survive (Review Focus 3); `clearAll` removes the five keys and nothing else.
  - TokenStoreTest: write then read round-trips through a fake cipher; a cipher that throws `AEADBadTagException` on decrypt → `read()` is null, the `t` entry is gone and `WidgetStore` holds none of the five keys (restore means signed out, Review Focus 5); `DeviceId.get` returns the same UUID v4 twice from `noBackupFilesDir/cubby_device_id`.
  - WidgetBridgeTest: `versions()` = `{ snapshot: WSnapshot.versions, shortcuts: <WActions keys with "shortcut" in places>, inPlace: true }`; `setSnapshot` with a `v` not in versions or a malformed JSON returns `{ ok: false }` and writes nothing; a good one writes appSnapshot byte-exact, calls refresh, and sets dynamic shortcuts for the snapshot's first 4 known keys: ids `go-<go>`, labels from WActions, intent ACTION_VIEW, data `https://little-cubby.com/app/?go=<go>&from=shortcut`, component MainActivity, unknown keys skipped; `hasWidgets()` with counts `{ medium: 2, small: 1 }` → exactly `{"value":true,"kinds":{"medium":2,"small":1,"lock":0}}` (the literal the JS section below feeds) and with none → `{ value: false, kinds: { medium: 0, small: 0, lock: 0 } }`; `mintToken` sends `{ idToken, hid, deviceId, platform: "android" }` (no `push` yet) and on 200 stores `t` and returns `{ ok: true, status: 200 }` with no `t` in it; on 401 `{ ok: false, status: 401 }` and no token; `revokeToken` has cleared the local token by the time the fake transport sees the request, which carries `Bearer <t>`; `hasToken()` follows the store. `clear()`, run under `runTest` with the bridge's `scope` = the test scope (P4 note 7):
```kotlin
assertEquals("""{"ok":true}""", bridge.clear().toString())               // resolved before the revoke is answered
assertTrue(FIVE_KEYS.none { prefs.contains(it) }); assertNull(tokens.read()); assertTrue(dynamicShortcutIds().isEmpty())
assertEquals(deviceIdBefore, DeviceId.get(ctx))
advanceUntilIdle()
assertEquals(listOf(Sent("POST", "https://little-cubby.com/api/widget/revoke", "Bearer $t", null)), transport.sent)
assertNull("the local clear came first", transport.tokenAtSend.single())
```
  With no token stored, `clear()` sends nothing; a revoke answering NotSent or Unknown leaves the same empty state and still `{ ok: true }`.
  - test/widget-ios-app.test.js, a new section 1b with section 1's vm harness: `Capacitor.getPlatform() === 'android'` and `Plugins.CubbyWidget.hasWidgets` answering `{"value":true,"kinds":{"medium":2,"small":1,"lock":0}}`: tracked equals `[['widget.installed', { kind: 'medium', count: 2 }], ['widget.installed', { kind: 'small', count: 1 }]]` (no lock event), and `window.__cubbyHasWidgets` deep-equals the answer. In section 3 (url only), the same Android stub: Settings shows neither P1's lock-screen row nor P3's stack helper (contract note 4).
- [ ] **Step 2: Run them and see them fail.** `bash tools/cap_android_build.sh --unit` → compile errors for the new types, BUILD FAILED. Once green, remove the Mutex from `updateNap` and watch the concurrency line FAIL; make `read()` skip `clearAll()` on a decrypt failure and watch the restore line FAIL; make `clear()` skip the revoke and watch the revoke line FAIL; restore all three. For the JS section (which may pass at once, since it tests P1's and P3's code): in a scratch edit of app/native-bridge.js return early from `reportWidgetKinds` unless `getPlatform() === 'ios'` and watch `node tools/gates.js --only=widget-ios-app` FAIL on section 1b; show the lock-screen row on `value` alone and watch `widget-ios-app-ui` FAIL on the Android line; restore app/native-bridge.js and app/index.html (`git diff --stat app/` is empty).
- [ ] **Step 3: Implement.** The plugin is a thin adapter (each method resolves the bridge's JSONObject as a JSObject); `CubbyWidgetPlugin` is the only class Capacitor instantiates, so every decision lives in `WidgetBridge`. `setSnapshot` skips `setDynamicShortcuts` when the current dynamic ids already equal the new list (the call is rate-limited). `clear()` never waits on the network: `widgetWipe` runs before a sign-out or switch continues, and the revoke is best effort once the token is gone from this phone.
- [ ] **Step 4: Run and pass.** `bash tools/cap_android_build.sh --unit` → BUILD SUCCESSFUL, ANDROID-WIDGET-CHECK: PASS (four expected files); `node tools/gates.js --only=widget-ios-app,test-wiring` → WIDGET-IOS-APP: PASS for both gates, TEST-WIRING: PASS.
- [ ] **Step 5: Commit.** `git add native-android/app/src && git commit -o native-android tools/android_widget_check.sh tools/test_wiring_check.js test/widget-ios-app.test.js -m "Android: the widget's shared container, its Keystore token revoked on every wipe, and the CubbyWidget plugin, with long-press shortcuts set only by the app" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 7: Sleep in place

**Files:**
- Create in native-android/app/src/main/java/com/littlecubby/app/widget/: NapReducer.kt (with NapRequest and NapParams), NapActionCallback.kt, CubbyNapCheckWorker.kt
- Create tests: NapReducerTest.kt (reads `/widget-copy.json`, the test resource Task 5's configure copies), NapActionCallbackTest.kt
- Modify: tools/android_widget_check.sh (`EXPECTED_TESTS+=(NapReducerTest.kt NapActionCallbackTest.kt)`), tools/test_wiring_check.js (their ALLOW entries)

**Interfaces:**
- Consumes: P4 POST /api/widget/nap (2.8: `{ action, babyIds, starts?, undo? }`, 200 `{ ok:true, already, state, at }`, 200 `{ ok:false, needsApp:true, state, at }`, 409 `{ error:'moved', state, at }`, 403 `{ error:'baby' }`, 401 `{ error:'token' }`, 400, 429, 503); P4 Task 9's `napCases` in docs/widgets/widget-copy.json (roadmap 2.3, contract note 5: each case a prior NapState, a request, an outcome, `now` and the expected NapState); Task 6 store, tokens, api, refresh; `WRules.undoMs`, `WRules.lineMs`, `WRules.pendingMs`.
- Produces:
```kotlin
data class NapRequest(val action: String, val babyIds: List<String>, val starts: Map<String, Long>?, val undo: String?)  // a start: starts null
object NapReducer { data class Result(val state: NapState, val clearToken: Boolean, val checkLater: Boolean)
  fun apply(prev: NapState, req: NapRequest, outcome: HttpOutcome, now: Long): Result }
object NapParams { val ACTION: ActionParameters.Key<String>     // "action"
  val BABY_IDS: ActionParameters.Key<String>   // "babyIds", comma-joined
  val STARTS: ActionParameters.Key<String>     // "starts", a JSON object; absent for a start
  val UNDO: ActionParameters.Key<String> }     // "undo"
class NapActionCallback : ActionCallback
class CubbyNapCheckWorker(ctx: Context, p: WorkerParameters) : CoroutineWorker(ctx, p)
  // unique "cubby-nap-check", REPLACE, NetworkType.CONNECTED, exponential backoff from 30 s
```
The reducer is P4 Task 9's reply table, held as data by `napCases`; this plan copies none of it, so the two platforms cannot drift. Outcomes map as P4 encodes them: a status reply → `HttpOutcome.Answer(status, body)` (body null for a 200 that is not JSON), offline → `NotSent`, unknown → `Unknown`. Android adds two flags the cases do not carry, each derived, never stored: `clearToken` is true exactly for a 401 (a tap or a `state` re-ask), and `checkLater` exactly when the resulting state keeps a `pending` (Unknown, and a `state` re-ask that fails other than with a 401).

The callback, in order: an Undo whose `until` has passed sends nothing; read the token (none: line notSaved until now + lineMs, refresh, stop); under `updateNap`, ignore the tap when a `pending` with an overlapping baby is younger than `WRules.pendingMs` (10000), else set `pending { babyIds, sentAt: now }`; refresh (the button dims); send (8 s on the wire, 10 s in all); reduce; clear the token or enqueue the check as the result says; refresh. The body never carries `t` or `hid` (2.8: the token rides in the header and the household comes from it).

- [ ] **Step 1: Write the failing tests.** NapReducerTest reads `napCases` from `/widget-copy.json` and fails when the list is missing or holds fewer than 11 cases (one per P4 Task 9 row), so an absent list can never pass empty; for each case, by name, `NapReducer.apply(prev, request, outcome, now).state` equals the case's NapState (canonical JSON, as in WidgetGoldenTest), `clearToken` is `outcome is Answer && status == 401`, and `checkLater` is `state.pending != null`. NapActionCallbackTest (Robolectric, WorkManagerTestInitHelper, a fake Transport that records each request and snapshots the store at send time): pending is set before the send; body keys are a subset of `{ action, babyIds, starts, undo }` and the header is `Bearer <t>`; Review Focus 3: two concurrent `onAction` calls for overlapping babies make exactly one request, two for disjoint babies make two and both babies' states survive; Review Focus 4: a transport answering Unknown leaves pending, sets no line and enqueues `cubby-nap-check`; a fresh `WidgetStore` over the same prefs (a new process) then running the worker against a fake 200 `state` reply clears pending and writes the babies; no active network (ShadowConnectivityManager) → no request and line `noConnection`; an Undo tapped after its `until` makes no request.
- [ ] **Step 2: Run them and see them fail.** `bash tools/cap_android_build.sh --unit NapReducerTest` → BUILD FAILED, types unresolved. Once green, drop the overlap refusal and watch the double-tap line FAIL; map Unknown to `notSaved` and watch the napCases unknown case FAIL by name; point the test at a copy of widget-copy.json without `napCases` and watch the count line FAIL; restore.
- [ ] **Step 3: Implement** to `napCases` and the order above.
- [ ] **Step 4: Run and pass.** `bash tools/cap_android_build.sh --unit` → BUILD SUCCESSFUL, ANDROID-WIDGET-CHECK: PASS; `node tools/gates.js --only=test-wiring` → PASS.
- [ ] **Step 5: Commit.** `git add native-android/app/src && git commit -o native-android tools/android_widget_check.sh tools/test_wiring_check.js -m "Android: Sleep starts and stops from the widget through the nap route, and an unanswered tap is checked, never called a failure" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 8: The medium and small widgets

**Files:**
- Create in native-android/app/src/main/java/com/littlecubby/app/widget/: WidgetLayouts.kt, WidgetContent.kt, CubbyMediumWidget.kt, CubbySmallWidget.kt, CubbyReceivers.kt, CubbyRedraw.kt
- Create in native-android/app/src/main/res/: xml/cubby_medium_info.xml, xml/cubby_small_info.xml, layout/cubby_widget_preview.xml, drawable/ic_cubby_arrow.xml, drawable/ic_cubby_play.xml, drawable/ic_cubby_stop.xml, drawable/ic_cubby_star.xml (F10's month-day star) (drawn symbols, tinted at render; no art)
- Modify: native-android/app/src/main/AndroidManifest.xml (the two receivers)
- Create tests: WidgetLayoutTest.kt, WidgetRenderTest.kt, WidgetReceiverTest.kt
- Modify: tools/android_widget_check.sh (receiver and provider checks; `EXPECTED_TESTS+=(WidgetLayoutTest.kt WidgetRenderTest.kt WidgetReceiverTest.kt)`), tools/test_wiring_check.js (their ALLOW entries)

**Interfaces:**
- Consumes: Task 5 `WidgetModel`, `ModelInput`, `ViewModel`, `nextChangeAt`, `Words`; Task 6 `WidgetStore`, `TokenStore`, `Links`, `WidgetRefresh`, `Receivers`; Task 7 `NapActionCallback`, `NapParams`; P3's generated `WColor(day: Long, night: Long)` and `WColors` (surface2, ink, inkSoft, line, feed, feedSoft, feedInk, sleep, sleepSoft, sleepInk, diaper, diaperSoft, diaperInk, pump, pumpSoft, pumpInk, note, noteSoft, noteInk, onSleep; resolved from app/index.html's `:root` and night blocks and gated by P3's widget-gen-ios test); P1's resources `w_gallery_medium_title`, `w_gallery_medium_desc_b`, `w_gallery_small_title`, `w_gallery_small_desc`, `w_word_cubby`; P1's ViewModel `url` for the widget body (roadmap 2.3) and `header.moment` (F10, M15; contract note 6), drawn in `WColors.feedInk`.
- Produces:
```kotlin
enum class Layout { WORDMARK, SMALL, SMALL_WIDE, MEDIUM, MEDIUM_WIDE }
object WidgetLayouts { val MEDIUM_SIZES: Set<DpSize>; val SMALL_SIZES: Set<DpSize>
  fun layoutFor(bucket: DpSize): Layout
  fun pick(actual: DpSize, sizes: Set<DpSize>): DpSize   // the launcher's rule: largest area that fits, else the smallest
  fun cellWidth(layout: Layout, bucket: DpSize): Double; fun buttonWidths(layout: Layout, bucket: DpSize, n: Int): List<Dp>
  fun family(layout: Layout): String }                   // MEDIUM* -> "medium", SMALL* -> "small"
class CubbyMediumWidget : GlanceAppWidget   // SizeMode.Responsive(MEDIUM_SIZES), PreferencesGlanceStateDefinition
class CubbySmallWidget : GlanceAppWidget    // SizeMode.Responsive(SMALL_SIZES)
class CubbyMediumReceiver : GlanceAppWidgetReceiver; class CubbySmallReceiver : GlanceAppWidgetReceiver
object ConfigKeys { val BABY; val BUTTON; val FIRST; val SECOND }   // stringPreferencesKey "baby", "button", "first", "second"
@Composable fun WidgetContent(vm: ViewModel, layout: Layout)
object CubbyRedraw { fun schedule(ctx: Context, appWidgetId: Int, at: Long?); fun cancel(ctx: Context, appWidgetId: Int) }
  // unique work "cubby-redraw-<id>", REPLACE, delay at - now, then WidgetRefresh.all
```
Sizes (dp), chosen so every bucket meets the layout floor (12 side padding, 6 between buttons, 8 between status cells reproduce the spec's 76 and 53 at 276):

| Bucket | Size | Layout | Sets |
|---|---|---|---|
| wordmark | 48x48 | WORDMARK | both |
| small | 130x154 | SMALL (stacked; 50dp buttons) | both |
| small, wide and short | 240x96 | SMALL_WIDE (text left, two buttons right) | both |
| small, tall alias | 240x154 | SMALL | small only |
| medium | 256x136 | MEDIUM (header, statuses, buttons) | medium only |
| medium, wide and short | 480x84 | MEDIUM_WIDE (statuses left, buttons right) | medium only |
| medium, tall alias | 480x136 | MEDIUM (so a big widget never takes the short one) | medium only |

So a 4x2 portrait (276x220) is MEDIUM, a 4x2 landscape (554x117) MEDIUM_WIDE, a 2x2 portrait (130x220) SMALL, a 2x2 landscape (269x117) SMALL_WIDE, and a 4x2 narrower than 256 the small layout: the floor wins over the cell count. A medium drawn as SMALL or SMALL_WIDE renders family "small" with its own baby and the small defaults. `cellWidth`: MEDIUM `(w - 40) / 3`, MEDIUM_WIDE `(w - 267) / 3`, SMALL `w - 24`, SMALL_WIDE `w - 134`. Sleep's column is fixed at 1.3/4 of the inner width less gaps at the bucket width; the others take `defaultWeight()` (Glance has no fractional weights).
Rendering decisions: Glance can only use system font families, so the display face is `FontFamily.Serif` and the body `FontFamily.SansSerif` (Fraunces and Nunito Sans cannot load in RemoteViews); every Text `maxLines = 1`; in the header the freshness text has no weight and the name has `defaultWeight()`, so the age goes first and the freshness never truncates; every colour is `ColorProvider(day = Color(c.day), night = Color(c.night))` of a `WColors` entry, so the widget follows the system's night mode; ground `surface2`; button kind is `feed`, `sleep` or `diaper` for those keys and `note` for every other (the quiet fourth slot), drawing `<kind>Soft` with `<kind>Ink` text; at night each soft button gets its 1dp stroke from an outer Box whose colour is the fill by day and the category hue (`feed`, `sleep`, `diaper`, `note`) by night, padded 1dp around the fill (Glance has no border); `style: 'solid'` draws `sleep` with `onSleep` text; `arrow` draws `ic_cubby_arrow` (11dp, stroke 2) at the top end; the small widget's Sleep shows `ic_cubby_play` for an intent action `start` and `ic_cubby_stop` for `stop`; `dim` draws `inkSoft` text on `line` with no click action; a row value equal to `Words.of(res, "status.notYet")` draws in `inkSoft`, every other value in `ink`; every button's semantics contentDescription is its `a11y` and every row's is the row's `a11y` (P1 note 4); a button with `url` uses `actionStartActivity(Links.view(ctx, url))`, one with `intent` uses `actionRunCallback<NapActionCallback>(NapParams ...)`; the widget body's click is `actionStartActivity(Links.view(ctx, vm.url))`; the model already gives `?baby=<id>&from=widget` for one baby, `?from=widget` otherwise, `?go=monthcard&baby=<id>&m=<total months>&from=widget` on a month day (F10), and `?go=sleep&baby=<id|both>&from=widget` while a `noConnection` or `notSaved` line shows, which wins (spec 6.5, 6.7 step 6), so no view code builds a URL.
Month day (F10), drawn only from `vm.header.moment` and never decided in a view: MEDIUM with one baby draws, in the age slot and instead of `header.age`, `ic_cubby_star` (10dp) then `moment.text`, both in `WColors.feedInk` (`0xFF895D24` by day, `0xFFE0A655` at night), at the age's size and face; the twins header, which has no name or age, draws the same pair at its start; SMALL and SMALL_WIDE draw the pair in place of the label line (row.baby, `sep.dot`, row.label), and the line under the clock then carries row.label joined to row.by with `sep.dot` ("last feed · Dad", or "last feed" with no `by`) as one Text, where on other days it carries `by` alone (spec 6.1, F9). The star is `Image(ImageProvider(R.drawable.ic_cubby_star), contentDescription = null, colorFilter = ColorFilter.tint(...))`, so TalkBack skips it; the moment Text's semantics contentDescription is `moment.a11y`. The moment takes the age's or the label's line, never a new one, so name, freshness, rows, buttons and the vertical budget are those of any other day. MEDIUM_WIDE and WORDMARK draw no header, so neither age nor moment (the FOUNDER STEP after this task). There is no location test: an Android widget is only ever on the home screen (the provider XML below), so the moment is drawn wherever its layout has the line, as `by` is. `provideGlance` reads the store, the token and the widget's ConfigKeys, schedules `CubbyRedraw` at `nextChangeAt`, then `provideContent` builds the input per `LocalSize`. Receivers add TIMEZONE_CHANGED and TIME_SET to their filter and answer with `WidgetRefresh.all` (goAsync), and cancel the redraw in onDeleted. Provider XML: `targetCellWidth` 4 and 2, `targetCellHeight` 2, `minWidth` 250dp and 110dp, `minHeight` 110dp, `minResizeWidth` 110dp, `resizeMode="horizontal|vertical"`, `widgetCategory="home_screen"`, `widgetFeatures="reconfigurable|configuration_optional"`, `updatePeriodMillis="1800000"`, `initialLayout="@layout/glance_default_loading_layout"`, `previewLayout="@layout/cubby_widget_preview"` (the wordmark `@string/w_word_cubby`, nothing else), `android:description` `@string/w_gallery_medium_desc_b` and `@string/w_gallery_small_desc`, and the receivers' `android:label` `@string/w_gallery_medium_title` and `@string/w_gallery_small_title` (Android ships Phase B, so the medium takes the "Start and stop sleep right here." description).

- [ ] **Step 1: Write the failing tests.**
  - WidgetLayoutTest: `pick` for (276,220) → 256x136 → MEDIUM; (554,117) → 480x84 → MEDIUM_WIDE; (130,220) → SMALL; (269,117) → SMALL_WIDE; a folded Fold 4x2 (258,190) → MEDIUM; unfolded (400,210) → MEDIUM; (250,190) → SMALL (the floor wins); (130,102) → WORDMARK; the small set at (276,220) → SMALL; for every bucket the vertical budget fits its height and every `buttonWidths` entry is at least 48dp; MEDIUM at 276 gives 76 and 53 (to the dp); `cellWidth(MEDIUM, 256)` is exactly 72.0, below 84, and every `cellWidth` is the unrounded Double ModelInput takes.
  - WidgetRenderTest (`runGlanceAppWidgetUnitTest`, `setAppWidgetSize` to each bucket): for the android fixtures medium, twins, small, stale, signed out, both pendings, Undo live, noConnection and notSaved, every non-null text of the vm (header, each row's label, value, by and day, each button label, the line, the message's words) has a `hasText` node; each url button `hasStartActivityClickAction(Links.view(ctx, url))`; each intent button `hasRunCallbackClickAction(NapActionCallback::class.java, params)`; a dim button has no click action; the widget body `hasStartActivityClickAction(Links.view(ctx, vm.url))`, which is `https://little-cubby.com/app/?baby=<id>&from=widget` for the medium fixture and `https://little-cubby.com/app/?go=sleep&baby=<id>&from=widget` for the noConnection and notSaved fixtures (Task 5's cases); the signed-out fixture shows no time at all (Review Focus 5); `Receivers.MEDIUM == CubbyMediumReceiver::class.java.name`, and the same for small.
  - WidgetReceiverTest (Review Focus 2): TIMEZONE_CHANGED and TIME_SET each reach `WidgetRefresh.all` (an APPWIDGET_UPDATE broadcast to both providers) and reschedule the redraw; the same anchor renders "2:10 PM" in Asia/Dubai and "11:10 AM" in Europe/London after the zone changes.
  - In WidgetRenderTest, colour: with the night uiMode a soft button's outer Box carries its category hue and by day the fill, and the solid button's text is `WColors.onSleep` (night `0xFF1A1614`).
  - In WidgetRenderTest, the month day (F10), on Task 5's moment cases, matched whole with `hasTextEqualTo` (a bare `hasText("3 months today")` would also match "13 months today"); the every-text loop above runs on them too, except `header.age`, which the age-slot line asserts absent:
```kotlin
// moment-medium (android), MEDIUM at (276,220)
onNode(hasTextEqualTo("3 months today")).assertExists()
onAllNodes(hasTextEqualTo(noneVm.header.age!!)).assertCountEquals(0)        // the age slot shows the moment instead
onNode(hasContentDescriptionEqualTo("Robin is 3 months old today")).assertExists()
onNode(hasStartActivityClickAction(Links.view(ctx, "https://little-cubby.com/app/?go=monthcard&baby=b1&m=3&from=widget"))).assertExists()
assertEquals(textsOf("moment-none (android)") - noneVm.header.age!!, textsOf("moment-medium (android)") - "3 months today")  // times, statuses, buttons never move
// moment-small (android), SMALL at (130,220) and SMALL_WIDE at (269,117)
onNode(hasTextEqualTo("Robin · 3 months today")).assertExists()
onAllNodes(hasTextEqualTo("Robin · last feed")).assertCountEquals(0)
onNode(hasTextEqualTo("last feed · Dad")).assertExists()
// twins
onNode(hasTextEqualTo("Robin and Wren · 3 months today")).assertExists()  // moment-twins-both, body ...baby=b1&m=3...
onNode(hasTextEqualTo("Wren · 3 months today")).assertExists()           // moment-twins-one, body ...baby=b2&m=3...
onAllNodes(hasText("today")).assertCountEquals(0)                         // moment-twins-differ; companion: the same matcher finds exactly 1 node in moment-twins-both
```
    plus: `moment-year1 (android)` draws `1 year today` and its body opens `https://little-cubby.com/app/?go=monthcard&baby=b1&m=12&from=widget`; `moment-line-noconn (android)` still draws `3 months today` and its body opens `https://little-cubby.com/app/?go=sleep&baby=b1&from=widget`; every body action equals `Links.view(ctx, vm.url)` (no view builds one); the moment Text and the star's tint are `0xFF895D24` by day and `0xFFE0A655` at night, and `WColors.feedInk == WColor(0xFF895D24, 0xFFE0A655)`; the star's Image node has no contentDescription, and the only node whose description names the day is the moment Text; twins' description equals `vm.header.moment.a11y` (no literal). Galaxy Fold (F8): `moment-medium` and `moment-twins-both` at the folded (258,190) and unfolded (400,210) sizes draw the moment node, the star and every row and button text they draw at (276,220); at (554,117), MEDIUM_WIDE, `moment-medium` draws no "today" node and the same rows and buttons as `moment-none`. Home screen only (F10, and F7's `by`):
```kotlin
for (xml in listOf(R.xml.cubby_medium_info, R.xml.cubby_small_info))
  assertEquals("home screen only, so no location test", AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN, widgetCategoryOf(res, xml))  // read with res.getXml
```
  - android_widget_check.sh: the merged manifest declares both receivers, each with `android.appwidget.provider` meta-data whose XML exists in the AAB with `widgetCategory` exactly `home_screen` and both feature flags (the built half of F10's home-screen-only line above); self-test plants a `keyguard` category and a missing small receiver.
- [ ] **Step 2: Run them and see them fail.** `bash tools/cap_android_build.sh --unit WidgetLayoutTest` → BUILD FAILED, `WidgetLayouts` unresolved. Once green, make `pick` compare widths only and watch (554,117) FAIL; draw the outer Box in the hue by day too and watch the colour line FAIL; give the body a fixed `?from=widget` and watch the noConnection body line FAIL; draw the moment in `ink` and watch the moment's day-colour line FAIL; draw `header.age` beside the moment and watch the age-slot line FAIL; in a scratch edit give the star a contentDescription and watch the star line FAIL; drop the type from the small's under-clock line and watch `last feed · Dad` FAIL; scratch-edit cubby_small_info.xml to `home_screen|keyguard` and watch the home-screen line FAIL; restore all.
- [ ] **Step 3: Implement** to the table and decisions above.
- [ ] **Step 4: Run and pass.** `bash tools/cap_android_build.sh --unit` → BUILD SUCCESSFUL, ANDROID-WIDGET-CHECK: PASS; `bash tools/android_widget_check.sh --self-test` → PASS; `node tools/gates.js --only=widget-parity,test-wiring` → PASS (P1's literal matchers find none in the new Kotlin and XML).
- [ ] **Step 5: Commit.** `git add native-android/app/src && git commit -o native-android tools/android_widget_check.sh tools/test_wiring_check.js -m "Android: the medium and small widgets, laid out by width and height, folded and unfolded, in Cubby's own day and night colours, with a baby's month day in honey" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

FOUNDER STEP: F10 on the two header-less Android layouts. A medium resized wide and short (480x84, MEDIUM_WIDE) or down to the wordmark (48x48) draws no header, so no moment, yet its body opens `vm.url`, which on a month day is the month card. He says which he wants: that card anyway, or Home. Until he answers it stays the month card (the contract's url, and no view builds a URL); "Home" would be a P1 model input, not a view rule.

---

### Task 9: Edit Widget on Android

**Files:**
- Create: native-android/app/src/main/java/com/littlecubby/app/widget/CubbyWidgetConfigActivity.kt
- Modify: native-android/app/src/main/AndroidManifest.xml (the activity, exported, with APPWIDGET_CONFIGURE), native-android/app/src/main/res/xml/cubby_medium_info.xml and cubby_small_info.xml (`android:configure`)
- Create test: ConfigActivityTest.kt
- Modify: tools/android_widget_check.sh (the activity and both `configure` attributes; `EXPECTED_TESTS+=(ConfigActivityTest.kt)`), tools/test_wiring_check.js (its ALLOW entry)

**Interfaces:**
- Consumes: Task 8 `ConfigKeys`, `CubbyMediumWidget`, `CubbySmallWidget`; Task 6 `WidgetStore.app()`; Generated `WActions.all`, `WDefaults`; P1's `WCopy.configBaby`, `configBoth`, `configYourButton`, `configFirstButton`, `configSecondButton`, `configDescription` and `fallbackPickBaby`, and P3's `config.smallDesc` (`WCopy.configSmallDesc`).
- Produces: `class CubbyWidgetConfigActivity : ComponentActivity`. Medium: rows Baby and Your button, then `configDescription`; small: Baby, First button, Second button (F9), then `configSmallDesc`. Baby lists each baby in appSnapshot by name, plus Both when there are exactly two; with no snapshot the row shows `fallbackPickBaby`. Your button lists WActions entries with "medium4" in places; First and Second list those with "small"; each list hides the other's current pick, so one action is never offered twice. Unset values stay null (the model's defaults apply, as on iOS); a reconfigure preselects the saved values. Rows are plain views at least 48dp, theme `@style/AppTheme.NoActionBar`, colours from `WColors`, no webview. Saving writes ConfigKeys through `updateAppWidgetState`, updates that widget, and finishes RESULT_OK with the id. An id whose provider is not one of this package's two receivers finishes RESULT_CANCELED and writes nothing.

- [ ] **Step 1: Write the failing test.** ConfigActivityTest (Robolectric, ActivityScenario): a medium id shows two rows, a small id three; the medium list equals WActions with "medium4" in WActions order and includes Say it only when Generated.kt has the voice entry; Both appears for two babies and not for one or three; picking Feed as First removes it from Second; every row is at least 48dp; saving stores the picks and returns RESULT_OK; an id from another package's provider returns RESULT_CANCELED and stores nothing.
- [ ] **Step 2: Run it and see it fail.** `bash tools/cap_android_build.sh --unit ConfigActivityTest` → BUILD FAILED. Once green, drop the provider check and watch the foreign-id line FAIL; restore.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run and pass.** `bash tools/cap_android_build.sh --unit` → BUILD SUCCESSFUL, ANDROID-WIDGET-CHECK: PASS; `node tools/gates.js --only=widget-parity,test-wiring` → PASS.
- [ ] **Step 5: Commit.** `git add native-android/app/src && git commit -o native-android tools/android_widget_check.sh tools/test_wiring_check.js -m "Android: Edit Widget holds which baby and which buttons, nothing else, and adding a widget never forces it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

FOUNDER STEP: br5. Say it stays in the Android lists only if he says yes once P1's widget-deeplink gate shows a widget-opened voice log never reaches the Pro sheet; if no, P1's QUICK_ACTIONS voice entry drops "android" from `widget.platforms` before any Android release (nothing shipped emits it yet).

---

### Task 10: The partner's log reaches this phone's widget

**Files:**
- Create in native-android/app/src/main/java/com/littlecubby/app/widget/: Pull.kt, CubbyPullWorker.kt, CubbyPokeService.kt (with PokeHandler)
- Modify: WidgetBridge.kt (mint sends `push`), CubbyReceivers.kt (onEnabled enqueues the pull, onDisabled cancels it when neither receiver has a widget), native-android/app/src/main/AndroidManifest.xml (`<service android:name="io.capawesome.capacitorjs.plugins.firebase.messaging.MessagingService" tools:node="remove"/>` and CubbyPokeService with the `com.google.firebase.MESSAGING_EVENT` filter, exported false)
- Create tests: PullTest.kt, PokeTest.kt; Modify: WidgetBridgeTest.kt
- Modify: tools/android_widget_check.sh (exactly one MESSAGING_EVENT service and it is CubbyPokeService; `EXPECTED_TESTS+=(PullTest.kt PokeTest.kt)`), tools/test_wiring_check.js (their ALLOW entries)

**Interfaces:**
- Consumes: P5 GET /api/widget/snapshot with `Bearer <t>` → 200 `{ snapshot: PullSnapshot, at }`, 401, 429, 503; P5's poke payload (2.9); P5's `WRules.pullMinMs` (600000) and `WRules.pullEveryMs` (3600000), its `shouldPull` rule and its fetch acceptance (its Task 8); the merge is the Task 5 model's (P5 Task 7's table); Task 6's `pokedAt` and `pullTriedAt`; the plugin's `MessagingService` (public, non-final, node_modules/@capacitor-firebase/messaging/android/src/main/java/io/capawesome/capacitorjs/plugins/firebase/messaging/MessagingService.java:7).
- Produces:
```kotlin
object Pull { fun shouldPull(now: Long, appAt: Long?, triedAt: Long?, pokedAt: Long?, hasToken: Boolean): Boolean
  suspend fun run(ctx: Context, api: WidgetApi = WidgetApi): Boolean }   // true when pullSnapshot changed
object PokeHandler { fun isWidgetRefresh(data: Map<String, String>): Boolean }    // data == {"cubby":"widget-refresh"}
class CubbyPokeService : MessagingService()
class CubbyPullWorker(ctx: Context, p: WorkerParameters) : CoroutineWorker(ctx, p)
  // unique periodic "cubby-pull", every pullEveryMs, NetworkType.CONNECTED, KEEP; pulls only when shouldPull
```
Decisions, P5's on both platforms: `shouldPull` is true when there is a token and either `pokedAt > triedAt` or `now - max(appAt, triedAt) >= pullMinMs`. `run` writes `pullTriedAt` before the request leaves; it accepts only a 200 with content-type application/json, a body of 64 KB or less and a `snapshot.v` in `WSnapshot.versions`, and writes `snapshot` as pullSnapshot (refreshing the widgets only when it changed); a 401 drops pullSnapshot and the token (deviceId and appSnapshot untouched); anything else, a hang past 8 s included, changes nothing; it never writes appSnapshot. A widget-refresh message is consumed (no super call, so a silent poke never reaches the webview): it writes `pokedAt`, then runs `run` and `WidgetRefresh.all` inside 9 s; every other message and `onNewToken` go to super. Mint adds `push` from `FirebaseMessaging.getInstance().token` within 3 s and omits it on failure; nothing asks for notification permission.

- [ ] **Step 1: Write the failing tests.** PullTest (P5's RF3 and RF5 on Android): the request is GET `https://little-cubby.com/api/widget/snapshot` with `Bearer <t>` and no body; no token → no request; `pullTriedAt` is written before the request leaves; 200 valid (its baby carrying `moments: [{ at: 1794873600000, unit: 'month', n: 3 }]`, F10) → pullSnapshot equals the reply's `snapshot`, moments included, and appSnapshot is byte-identical; 401 → token and pullSnapshot gone, deviceId kept; 503, a hang past 8 s, a 200 `text/html` body, truncated JSON, `v` 2 and a body over 64 KB → pullSnapshot and appSnapshot byte-identical; `shouldPull` for P5's four cases (no token; poked; app live 5 min ago; app and try both 11 min ago). PokeTest: `isWidgetRefresh` is true only for exactly `{"cubby":"widget-refresh"}` (false with an extra key, another value, or a notification-shaped map); the service's handling of a widget-refresh runs the pull once and calls no super path (a counting fake). WidgetBridgeTest: mint's body carries `push` when the token source answers and leaves it out when it throws.
- [ ] **Step 2: Run them and see them fail.** `bash tools/cap_android_build.sh --unit PullTest` → BUILD FAILED. Once green, let the poke fall through to super as well and watch PokeTest FAIL; restore.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run and pass.** `bash tools/cap_android_build.sh --unit` → BUILD SUCCESSFUL, ANDROID-WIDGET-CHECK: PASS; `bash tools/android_widget_check.sh --self-test` (a planted manifest with both services) → PASS; `node tools/gates.js --only=test-wiring` → PASS.
- [ ] **Step 5: Commit.** `git add native-android/app/src && git commit -o native-android tools/android_widget_check.sh tools/test_wiring_check.js -m "Android: a partner's log reaches this phone's widget through a silent poke and a pull, and the poke never reaches the app" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 11: The iOS-only window ends

Run this task only after the founder says the closed test passed (the founder steps below).

**Files:**
- Modify: docs/widgets/widget-copy.json (`"platforms": { "ios": "on", "android": "on" }`) and everything `node tools/widget_gen.js` regenerates
- Modify: tools/widget_parity_check.js (P1's file: an "android on" section and its self-test plants)
- Modify: docs/TESTING.md (the Mac-only Android rows say they now guard a shipped surface)

**Interfaces:**
- Consumes: P1's widget_parity_check.js and its `--self-test`; Tasks 2, 8 and 9's manifest and provider XML.
- Produces: while `platforms.android` is "on", widget_parity_check fails unless native-android/app/src/main/AndroidManifest.xml declares CubbyMediumReceiver and CubbySmallReceiver with provider XMLs that exist, declare `widgetCategory="home_screen"` only and both feature flags, name CubbyWidgetConfigActivity as `configure`, and take their label and description from `w_` gallery resources whose keys list "android".

- [ ] **Step 1: Write the failing test.** In widget_parity_check.js `--self-test`, with "on": plant a manifest missing the small receiver, a provider with `home_screen|keyguard`, and a receiver labelled `@string/app_name` instead of its gallery resource; each must go red (a literal label is already P1's section 5).
- [ ] **Step 2: Run it and see it fail.** `node tools/gates.js --only=widget-parity` → the three plants are not caught, FAIL.
- [ ] **Step 3: Implement** the section; flip `platforms.android` to "on"; `node tools/widget_gen.js`.
- [ ] **Step 4: Run and pass.** `node tools/gates.js --only=widget-parity,android` → PASS; `bash tools/cap_android_build.sh` with `CUBBY_REL` set for the release → BUILD SUCCESSFUL, ANDROID-WIDGET-CHECK: PASS, ANDROID-PARITY: PASS.
- [ ] **Step 5: Commit.** `git commit -o docs/widgets tools/widget_parity_check.js docs/TESTING.md native-android -m "Android widgets are on: the parity gate now holds Android to every widget iOS has" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

FOUNDER STEP: a Play developer account (one made after Nov 2023 runs a 12-tester, 14-day closed test first); the store listing, content rating and Data safety form (first-party measurement only, nothing shared); uploading the first AAB from Task 4, which creates the Play app signing key whose SHA-256 then goes into `ANDROID_CERT_SHA256` and the Firebase Android app.
FOUNDER STEP: the device proofs on the closed-test build, which are Phase 0's exit: sign in with Google and with Apple (if Apple returns no idToken on Android, the step reads `provider` and that is a new question for him, not a fix to make here); `adb shell pm get-app-links com.littlecubby.app` shows little-cubby.com verified; on a Galaxy Fold, folded and unfolded, add each widget, resize it, tap each button and check its sheet and baby, start, stop and undo sleep, and see a partner's log arrive; and on a month day (a test baby whose birth date makes today one, F10), folded and unfolded, the medium's age line and the small's label line read the day whole in honey with the star, the small's clock line reads "last feed" with the logger, TalkBack reads "<name> is 3 months old today" (that day's count) and skips the star, and a tap on the body opens that month's card with no Pro mark.
FOUNDER STEP: each push to main (push = deploy), with the emulator tier for the Worker change in Task 3; the production release once the closed test ends; then this task's commit and its push.
