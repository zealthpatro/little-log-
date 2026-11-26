# Notes for Apple's reviewer (iOS build)

Working notes for the App Review "Notes" field and the questions a reviewer is likely to ask. The paste-ready
reviewer text, the demo-account steps and the privacy questionnaire live in
`docs/plans/2026-08-04-app-store-listing.md` (sections 4 and 6); this page says what changed for this build
and what each answer rests on, so the two stay in step. Plain words, no em-dashes, nothing claimed that the
build does not do.

## What the app is

Cubby is a private, shared log for a baby or a pregnancy: feeds, sleep, nappies, growth, vaccines and
medicines, kept by one parent or by a family circle together. Every entry records who added it. The
interface is served from little-cubby.com inside a Capacitor wrapper (bundle id `com.littlecubby.app`); the
binary adds Sign in with Apple, push registration, camera and photo library, microphone and on-device speech
recognition for voice logging, haptics, universal links, the share sheet and the file system (calendar files
for reminders). Category Health & Fitness, rating 4+, free, no in-app purchase.

## Sign-in options

Sign-in is required: server-side rules key every record to the signed-in account, so there is no signed-out
state that holds data.

- **Sign in with Apple** (native). Offered first on iOS, as guideline 4.8 asks when Google is offered.
- **Continue with Google** (native, through Firebase Authentication).
- **Email**: one message carries a code and a link; on iOS the code is typed into the app, so sign-in
  finishes inside the app's own storage.

## A demo path that needs no real email

1. **Sign in with Apple, on the reviewer's own device.** It creates a working account in one step. With
   "Hide My Email" the account gets an Apple relay address, so no real email is shared with Cubby. The app
   then opens first-run setup; adding a baby takes about thirty seconds and Home fills straight away. A
   fresh account has no seeded data, so the reviewer adds one entry to see the timeline.
2. **A seeded demo account (founder step, not done by this lane).** The listing's section 6 describes a
   dedicated Google account for review with a fictional family ("Bo Bear"), two caregivers and a week of
   entries, credentials entered in the App Store Connect demo-account fields. Whether that account exists
   today is not recorded here; if it does not, submit with the "WITHOUT a demo account" paragraph from the
   listing, which points the reviewer at path 1.

No test account was created for this note.

## Health disclaimer

Cubby is a log and a set of reminders, not medical advice. Every health record is entered by the parent.
Cubby does not calculate medication doses, does not diagnose, and makes no medical claim. Immunisation
schedules cite their national sources. A medicine entry is a log and a reminder for a dose already prescribed
to that family. The site footer says "Cubby is informational and not a substitute for medical advice.
Always follow your doctor and your country's official guidance." Inside the app the health screens carry
"Informational only, not medical advice" lines, with the official source beside each schedule.

Not claimed: that any clinician has reviewed the app's health content or the articles on little-cubby.com.
Do not say so to App Review unless that review has actually happened and is written down.

## No third-party tracking

- No advertising, no third-party analytics and no tracking SDK in the app. The Meta SDK is stripped from the
  binary and `tools/cap_ios_build.sh` refuses a build that links it.
- The privacy manifest (`native-ios/PrivacyInfo.xcprivacy`, bundled by `tools/cap_ios_configure.rb`)
  declares `NSPrivacyTracking` false and no tracking domains. Its collected data types match the App Privacy
  answers in the listing, section 4: email, name, health, photos, other user content, user ID, device ID
  (Cubby's own random install id, not the advertising identifier), product interaction and other diagnostic
  data, all linked to the account, none used for tracking. `tools/privacy_manifest_check.js` gates it, and
  `tools/ios_launch_smoke.sh` checks it is inside the built app.
- Required-reason APIs: the app declares file timestamps (C617.1) for the Filesystem plugin, whose library
  ships no manifest of its own. Capacitor, Firebase, Google Sign-In and their dependencies carry their own
  manifests for UserDefaults, file timestamps and system boot time.
- No App Tracking Transparency prompt, because nothing tracks.
- Cubby measures how its own features are used, first-party, on its own servers: which screens and buttons,
  never what anyone types or logs. It is switched off for families today (`USAGE_MODE` "off" in
  `wrangler.toml`); the App Privacy answers must be live in App Store Connect before it is switched on.

## Other things a reviewer may meet

- **No connection on first open.** If the site cannot load and nothing is cached yet, the app shows a bundled
  page (`cap-web/error.html`, `server.errorPath`): "Cubby can't open just now", a Try again button, and an
  automatic retry when the connection comes back. Not a blank screen.
- **iPad.** The target builds for iPhone and iPad (`TARGETED_DEVICE_FAMILY` 1,2). The app caps its width at
  480 points and centres it; from 900 points wide it is drawn inside a frame. Checked at 820 x 1180 and
  1180 x 820 for this build, which found and fixed a closed sheet peeking under the frame on wide screens
  (`test/wide-sheet.test.js`).
- **Pregnancy loss.** If a loss is recorded, the app becomes a quiet holding screen and stops its prompts.
  Nothing is graphic.
- **Purchases.** None in this version. The Cubby Pro screen describes a planned subscription and collects
  interest by email only; it takes no payment and links to no store.
