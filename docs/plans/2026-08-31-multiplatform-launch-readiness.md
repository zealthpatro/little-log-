# Do we need to refactor for a joint iOS + Android launch?

**No. The app needs no porting. Everything missing is the Android native shell and the store
plumbing, and one of those gaps fails silently.**

Run the evidence yourself: `node tools/android_parity_check.js` (7 passed, 6 failed on 31 Aug 2026).

## Why there is nothing to refactor

- **One web codebase, remote-loaded by both wrappers.** `capacitor.config.json` sets
  `server.url = https://little-cubby.com/app/` for iOS and Android alike. Shipping to `main` updates
  both installed apps with no review and no rebuild. Tonight's v350 is already in the iOS app.
- **The app is already platform-agnostic.** Across `app/`, exactly TWO places branch per OS:
  `app/landing.js:20` and the status-bar call at `app/native-bridge.js:119`. Everything else is the
  binary `isNativeApp()` (29 uses), which Android satisfies identically.
- **Push is already multiplatform at the server.** The Worker sends via `fcm.googleapis.com`, and FCM
  delivers to both Android and iOS. Registration goes through `@capacitor-firebase/messaging`, whose
  `getToken()` returns a real FCM token on both.
- **Auth is already multiplatform**, via `@capacitor-firebase/authentication`.

A "multiplatform system" already exists. What does not exist is the Android half of the *release*
path, and the difference matters: the first is design work, the second is a checklist.

## The one that will bite, because it does not announce itself

`android/app/build.gradle:46-53` reads `google-services.json` inside a `try`, and when the file is
missing it catches the exception and calls **`logger.info`**, which is invisible at Gradle's default
log level:

```gradle
try {
    def servicesJSON = file('google-services.json')
    if (servicesJSON.text) { apply plugin: 'com.google.gms.google-services' }
} catch(Exception e) {
    logger.info("google-services.json not found, ... Push Notifications won't work")
}
```

The file is **absent**. So a release build SUCCEEDS, uploads to Play, installs, opens, and cannot sign
anybody in or deliver a single notification, and nothing at any point says so. That is the same shape
as the four-day sign-in outage: not a miswired alarm, no alarm, and a remedy that looks alive from
outside. It is the first thing to fix and the easiest to miss, because every other signal is green.

## The rest of the Android gap, in order

| # | Gap | Consequence | Whose |
|---|---|---|---|
| 1 | `google-services.json` missing | builds clean, ships with auth + push dead | mine, once the file exists |
| 2 | No `signingConfig` in the release buildType | unsigned; Play refuses it | **founder generates the keystore** |
| 3 | No `autoVerify` intent filter; `/.well-known/assetlinks.json` 404 | sign-in and `/app/?go=` links open Chrome, not the app | blocked on 2 (needs the release SHA-256) |
| 4 | `versionCode 1` / `versionName "1.0"`, scaffold defaults | the two stores disagree on what a release is called | mine |
| 5 | No `tools/cap_android_build.sh` | no scripted path to an AAB; first upload hand-driven | mine |
| 6 | `ANDROID_HOME` unset, SDK absent, JDK 26 (AGP wants 17/21) | cannot build at all today | mine |

Gap 3 is the one worth understanding rather than ticking. It is the Android twin of the iOS storage
container P0: on iOS a tapped link completes in Safari and the installed app stays signed out, which
is why the one-time code path exists. On Android, without verified App Links, the same tap opens
Chrome. The emailed code path already saves this case on both, which is a good argument for keeping
the code route primary rather than treating it as an iOS workaround.

## The one place remote-loading is genuinely dangerous, on BOTH stores

Everywhere else, one web app serving two wrappers is the strength of this design. Here it is a live
hazard, and it is the strongest argument in this document for hardening rather than refactoring.

`app/index.html` carries a Pro checkout: `PRO_CFG.checkoutUrl`, a Lemon Squeezy flow via
`startProCheckout`. **Today it is safe.** The URL is `''` and the function bails on its first line to
the waitlist, so nothing external is reachable and there is no exposure. It was verified, not assumed.

The hazard is what happens the day somebody sets that one string. Apple's Guideline 3.1.1 requires
in-app purchase for digital content, and Google Play Billing says the same for Play. Cubby has no
StoreKit and no IAP entitlement at all, so the moment that URL is set the shipped apps start linking
out to an external checkout for a digital subscription. **And because both wrappers remote-load
little-cubby.com/app/, that change reaches installed, already-reviewed phones without passing review.**
A single web-side config edit can retroactively make a shipped, approved app non-compliant on both
stores at once, with no build, no submission and no signal.

That is the same family as everything else found this week: a change that looks purely web-side
silently reaching a surface that has different rules. It needs a native-platform guard so external
checkout can never render inside either wrapper, plus a gate asserting the guard exists, BEFORE Pro
opens in October 2026. It is not urgent today and it must not be forgotten, because the day it matters
there will be no warning.

## Does the multiplatform system need to be more robust?

Not restructured. **Gated.** Every gap above is a thing that is either present or absent, which is
exactly what a gate is for, and the reason the iOS wrapper is trustworthy today is that
`tools/cap_ios_build.sh` is the only sanctioned path (a raw archive ships no entitlements).

`tools/android_parity_check.js` now asserts all six, each with the consequence written into the
failure message rather than a bare "missing". It is DELIBERATELY NOT in `tools/gates.js`: it is
honestly red until the Android work is done, and a permanently red gate teaches people to stop reading
the suite. Wire it in on the day it first passes, the same way `signin_live_check.js` sits in
OPERATIONS.md rather than the suite because it writes to production.

## Recommendation

Ship iOS now; it is four fields from submittable. Do not hold it for Android.

Then do the Android list in order. Gaps 1, 4, 5, 6 are a morning's work and mine. Gap 2 is the
founder's and is the long pole, because the upload keystore must be generated AND backed up before
anything else can be signed, and losing it means the listing can never be updated again. Gap 3
unblocks the moment 2 lands.

The joint-launch question answers itself once the list is written down: the two stores are not
symmetric today, but the asymmetry is entirely in release plumbing, and none of it argues for
touching the app.
