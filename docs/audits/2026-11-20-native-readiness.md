# Native readiness: iPhone and Android, 20 November 2026

Read-only run-through of both shells, each claim re-checked by a second reader. Nothing was built, booted or
uploaded. Both shells are Capacitor wrappers that load `https://little-cubby.com/app/` remotely, so a push to main
reaches an installed app on its next open with no rebuild. Anything native (plugins, entitlements, signing, the
app name, widgets) needs a new build instead.

Production at the time: main 58733b16, service worker little-log-v369.

## iPhone

State
- Build 2026.47.1 uploaded 16 Nov 00:24 +04 and in internal TestFlight ("Beta users"). It carries the iOS 27
  UIScene fix; the launch smoke held 12 s on the iOS 27 simulator; the hourly crash watch shows none on it.
- Bundle id com.littlecubby.app, deployment target 15.0, iPhone and iPad (device family 1,2). Built only through
  `tools/cap_ios_build.sh` (Xcode 27.2). The iOS project folder is gitignored and lives in the main checkout.
- Universal links, Apple sign-in, Google sign-in and `aps-environment production` are in the signed build.
- App Store: version 2026.33.1 sits in "prepare for submission". Nothing has ever been submitted for review.
- No WidgetKit target exists. Plan 3 has 0 of 48 steps done.

What a push to main changes for iPhone users: every web fix, at once. What it cannot change: the app name on
iOS's own sheets (the uploaded build still says "App"), launch-link handling, icon, splash, and widgets.

Open before it can be called flawless

| # | What | Owner | Next step |
|---|---|---|---|
| I-1 | The email sign-in link opens the app and then reloads in a loop | Claude (release owner's lane) | Ship the fix lane with its two tests; re-check on a signed simulator build. Capacitor's `lastURL` is `private(set)`, so the native half needs a different design than "clear it" |
| I-2 | The app can say "we emailed you" when the send was suppressed or bounced | Claude (release owner's lane) | Ship the mail fix lane; the only recorded device attempt (16 Nov) never received the email |
| I-3 | Signing in by typed code is not proven inside the native app | Founder + Claude | `ios-signin` emulates a home-screen web app with stubbed endpoints; a device run is the proof |
| I-4 | Build names itself "App" on system sheets | Claude builds, founder approves upload | New build after the release push (2026.47.2 or 2026.48.1) |
| I-5 | First open with no connection shows a blank screen | Claude | `capacitor.config.json` has no `server.errorPath`; point it at the bundled offline page |
| I-6 | No app-level privacy manifest | Claude | Add `PrivacyInfo.xcprivacy` to the App target; check the founder's inbox for ITMS-91053 |
| I-7 | iPad is in the build but not in the store plan | Founder decides | Ship iPhone only, or add 13-inch iPad screenshots; App Review opens an iPad build on an iPad |
| I-8 | Scheduled reminders have never been proven on a device | Founder + Claude | Only the direct sender has delivered. `tools/push_send_test.js --send ios` messages EVERY iPhone token: list first, never run it as a private test |
| I-9 | Reviewer notes have four wrong lines | Claude drafts, founder approves | `docs/plans/2026-08-04-app-store-listing.md`, first fenced block, before any submission |
| I-10 | Stuck sign-in advice tells an installed user to use Safari | Founder approves wording | `stuckSignInMsg()` in `app/store-firebase.js` |

Cautions for whoever builds next
- `tools/cap_ios_build.sh`, even with `--local`, removes `/tmp/Cubby.xcarchive`, the only local copy of the uploaded
  2026.47.1 archive and its dSYMs. That needs a yes first (never delete without one).
- Read Apple's side before building: `node tools/asc.js builds` and `node tools/asc.js state`. An expired agreement
  failed one export on 15 Nov; only the founder can accept one.

Founder's steps for iPhone
1. Say yes to each TestFlight upload.
2. On a real iPhone with the TestFlight build: Continue with Apple, Continue with Google, email with the 6-digit
   code, the link in the email, an invite link, one reminder.
3. For outside testers: create the review demo account, paste the Beta App Review notes, add the external group.
4. For the App Store: review phone number, App Privacy answers, the Pro surfaces decision, then approve the submit
   (irreversible).
5. For widgets later: add App ID `com.littlecubby.app.widget` and App Group `group.com.littlecubby.app` in the
   developer portal.

## Android

State: not ready. A July Capacitor scaffold exists in the main checkout (gitignored, applicationId
com.littlecubby.app). It has never been built, signed, installed or uploaded, and it cannot be built on this Mac
today. Plan 6 has 0 of 56 steps done.

| # | What | Owner | Next step |
|---|---|---|---|
| A-1 | No JDK 21 and no Android SDK on this Mac | Founder says yes (about 4 GB) | `brew install --cask temurin@21 android-commandlinetools`, then sdkmanager: platform-tools, platforms;android-36, build-tools;36.0.0 |
| A-2 | The scaffold is stale and unversioned | Claude | Plan 6 Task 2: a fresh shell made in the build worktree (`cap add android`), tracked shell files under `native-android/`, `tools/cap_android_configure.js`. The July folder is only read |
| A-3 | `google-services.json` is not in the project and the build hides that | Claude | Configure step copies it from `~/.android-keys`; the Gradle plugin applies unconditionally so a missing file fails the build |
| A-4 | Google sign-in is not wired natively; the missing classes would most likely crash the app at launch | Claude | `rgcfaIncludeGoogle = true` in the tracked `variables.gradle`; prove on a build signed with the upload key |
| A-5 | Release is unsigned | Founder writes `keystore.properties` by hand | Password stays in the password manager, never in chat. Back up `cubby-upload.jks`: losing it blocks updates |
| A-6 | Version is the scaffold default, which also keeps reminders off | Claude | CalVer version properties as on iOS |
| A-7 | App Links not set up: the emailed link opens Chrome | Claude, then founder after first upload | `/.well-known/assetlinks.json` Worker route with the upload key's SHA-256 now, the Play signing key appended later |
| A-8 | Push is not wired for Android, and the dose reminder has no Android block | Claude | FCM in the shell; an `android` block with channel, collapse key and private visibility; no action button exists on Android today |
| A-9 | Apple sign-in on Android is likely to fail | Claude proves, founder decides | The plugin completes a native sign-in and the web layer then exchanges the same credential a second time. Hide the Apple button on Android until proven |
| A-10 | No scripted build path; the parity gate has false passes and is not in the suite | Claude | `tools/cap_android_build.sh`; fix and wire `tools/android_parity_check.js` red then green |
| A-11 | Launcher icon is the Capacitor default | Claude | Brand tool |
| A-12 | Voice logging has no Android path | Claude | Android WebView has no SpeechRecognition and the manifest lacks RECORD_AUDIO. It falls back to typing silently; the Pro list still advertises it |
| A-13 | File saves unproven (.ics, doctor PDF, keepsakes) | Claude + device | Filesystem and Share plugins are not in the synced project; Google Calendar may not accept a shared .ics |
| A-14 | `android:allowBackup="true"` | Claude | WebView storage, session included, goes into Google backup. Decide deliberately for a privacy product |
| A-15 | Pro checkout has no native guard | Claude | Safe today (the URL is empty); one config edit would put an external checkout inside a Play app |
| A-16 | Status bar branch is dead code on API 36, and the viewport has no `viewport-fit=cover` | Claude | Check edge-to-edge on a device, folded and unfolded |
| A-17 | Google Play account and store setup do not exist | Founder | Account (25 USD, identity check), trader status, listing, content rating, Data safety, Health apps declaration, App access notes for reviewers, account-deletion URL, ads declaration |
| A-18 | After the first Play upload, Google sign-in breaks for Play installs until the Play signing key is registered | Founder | Copy Play's SHA-1 and SHA-256 into the Firebase Android app, re-download `google-services.json`, hand over the SHA-256 for assetlinks |
| A-19 | Nobody has run this shell on an Android device | Founder + Claude | Boot, back button, the three sign-ins, an emailed link, one reminder, a Galaxy Fold folded and unfolded. Also check `window.Capacitor` exists on a second launch from the service worker cache |

Calendar floor: a new personal Play account must run a closed test with at least 12 testers for 14 days before
production. An internal-testing install is near; a public Android release is weeks away at best.

Proofs need the right key: Firebase holds only the upload key's fingerprints, so Google sign-in, Apple's web flow
and App Links verification fail on a debug-signed build whatever the device.

## Order that gets both platforms to testers soonest

1. Push the release (web fixes reach TestFlight users at once), then a new iPhone build for the app name.
2. Android shell without widgets (plan 6 Tasks 1 to 4) as soon as A-1 and A-5 are done, into Play internal testing,
   so the 14-day closed-test clock can start.
3. Founder's device walks on both.
4. Widgets on both follow as their own builds (plans 1 to 6).
