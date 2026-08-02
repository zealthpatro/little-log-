# Getting Cubby into the App Store + Play Store (Capacitor wrapper)

**Goal:** a one‑tap install on iPhone (and a Play Store listing) that reuses 100% of the existing PWA. No rewrite.
**Why Capacitor, not TWA:** TWA is Android‑only. Capacitor wraps the *same* web app for **both** iOS and Android.
**Status (2026-08-02):** **build 9 VALID in TestFlight — use this one.** Build 9 = the real bear launch splash
(no more Capacitor blue X; `tools/gen_splash.py`, §4) + a clean rebuild on Xcode 26.6 / iOS 26.5 SDK, shipped
via `tools/cap_ios_build.sh` with the entitlement + Meta-SDK gates green. **Build 8 (same day) is BROKEN — do
not test on it**: it was uploaded via the raw §7 commands, which skip entitlement embedding (the builds 1-5 bug
again), so Apple sign-in and push are silently dead in it. Founder will expire it later.
The Mac had lost Xcode in a disk cleanup (reinstall via App Store, then `xcodebuild -downloadPlatform iOS`;
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` beats sudo `xcode-select`) and the Apple Development
cert with it — recreated via the ASC API (Admin key, POST /v1/certificates; private key in
`~/.appstore-keys/dev-cert/`). Builds 6-7 (2026-07-16/17) carried the Sign in with Apple entitlement fix +
universal links. Simulator smoke re-verified: app-bound domain, SW registration, native landing, splash.
Build 1 proved the wrapper loads the PWA but could not sign in (§3c). Steps marked 🖥️ need the founder's Mac —
though Claude Code *runs on* that Mac, so it drives `xcodebuild`/`xcrun` directly (§7). What Claude still
cannot do: Apple/Firebase console login + 2FA, create API/APNs keys, the 1024 icon, an on-device sign-in or
push test, or clear Apple review.

---

## 0. What already exists (don't re‑create)
- **Apple Developer account** — yes (powers Sign in with Apple). Team `F5NVQV7NVB`. App ID `com.littlecubby.app` already registered.
- **Firebase** project `little-log-a9caa` (FCM already used for web push).
- **Icons** in `/icons/` (192, 512, apple‑touch, logo‑512). Reuse for the app icon + splash.
- **The app** is served at `https://little-cubby.com/app/`.

## 1. Load strategy — decide first
Two options; pick per Apple‑review appetite:

- **A. Remote‑load (recommended for Cubby).** `capacitor.config` `server.url = "https://little-cubby.com/app/"`. The shell loads the live site, so you keep shipping via Cloudflare and **rarely re‑submit** (only shell/native changes need review). Risk: Apple guideline **4.2** ("minimum functionality / just a website"). Mitigate by shipping real native features (push, splash, status bar) so it's clearly an app, not a bookmark.
- **B. Bundled.** Copy `app/` into the Capacitor `webDir`; updates need a re‑sync + re‑submit each time. Passes 4.2 more easily but breaks the instant‑deploy workflow (you bump `app/*` constantly). Use only if A gets rejected.

Recommendation: **start with A**, keep B as the fallback if review pushes back.

## 2. Prereqs 🖥️
- macOS + **Xcode** (latest) + Command Line Tools + **CocoaPods** (`sudo gem install cocoapods`).
- **Node** (already have). **Android Studio** (for the Android build).
- **Google Play Console** account — $25 one‑time, individual is fine (ID verification, no company).
- Apple Developer — already have.

## 3. Scaffold Capacitor 🖥️
**Already in the repo (built + verified, inert on web):** `capacitor.config.json` (option A, remote-load),
`cap-web/index.html` (throwaway webDir), and `app/native-bridge.js` (push + deep-link bridge, wired into
the app, guarded on `Capacitor.isNativePlatform()` so it's a no-op in the browser). So **skip `cap init`**.

On the Mac, from the repo root — install the deps, add the platforms, then run the two config scripts.
**`ios/`, `android/`, `package.json` and `node_modules/` are all gitignored** (the Worker serves the whole
repo), so the native project is disposable and regenerated from this block. Anything you change by hand in
Xcode is LOST on the next `cap add` — that is why the scripts exist. Re-run this whole block on a fresh machine:
```bash
npm i @capacitor/core @capacitor/ios @capacitor/android @capacitor/app @capacitor/splash-screen \
      @capacitor/status-bar @capacitor/push-notifications @capacitor/browser @capacitor/haptics \
      @capacitor-firebase/authentication
npm i -D @capacitor/cli
node tools/cap_strip_facebook.js     # MUST run before sync — see §3b
npx cap add ios
npx cap add android
npx cap sync
gem install --user-install xcodeproj # once
ruby tools/cap_ios_configure.rb      # plist as a resource + Sign in with Apple entitlement
python3 tools/gen_app_icon.py        # the real bear icon — cap ships a placeholder (§4)
```

### 3b. The Facebook SDK trap (do not skip)
`@capacitor-firebase/authentication`'s **CocoaPods** podspec defaults to a `Lite` subspec with no third-party
deps. Its **Swift Package Manager** manifest does not: it hardcodes `facebook-ios-sdk`. Capacitor 8 uses SPM,
so a plain `npm i` links **Meta's SDK into the Cubby binary** — directly against the "no third-party trackers"
promise. `tools/cap_strip_facebook.js` removes the dependency and the `RGCFA_INCLUDE_FACEBOOK` flag (all the
plugin's Facebook code is behind that `#if`, so it still compiles). Verify after any archive:
```bash
otool -L /tmp/Cubby.xcarchive/Products/Applications/App.app/App | grep -i fbsdk   # must be empty
strings  /tmp/Cubby.xcarchive/Products/Applications/App.app/App | grep -ci fbsdk  # must be 0
```
(The bridge accesses the plugins via `window.Capacitor.Plugins.*` at runtime — no bundler/import needed,
which is why it works with the remote-loaded PWA.)

## 3c. Sign-in: why the wrapper needs native auth (SOLVED, build 2)
**Symptom (build 1, 2026-07-16):** the app loaded fine but sign-in bounced out to Safari and died with
*"Unable to process request due to missing initial state ... signInWithRedirect in a storage-partitioned
browser environment."*

**Cause:** `signInWithPopup` / `signInWithRedirect` are *browser* mechanisms. Inside a WKWebView the OAuth URL
is handed to the system browser, so the redirect completes in Safari while Firebase's handshake state sits in
the *webview's* `sessionStorage`. It can never work in a wrapper. This is not fixable by config, and **do not
try to "fix" it by re-pointing `authDomain`** — that caused the 2026-07-13 sign-in outage (see
`reference_signin_authdomain.md`); it stays `little-log-a9caa.firebaseapp.com`.

**Fix:** do the provider dance natively, then hand the credential to the same JS SDK the app already uses, so
auth state / Firestore rules / listeners are unchanged. In `app/store-firebase.js`, `signInGoogle()` and
`signInApple()` branch on `nativeAuth()` (non-null only inside the wrapper) into `nativeSignIn(kind)`:
`FirebaseAuthentication.signInWithGoogle|Apple({ skipNativeAuth: true })` → `auth.signInWithCredential(...)`.
`skipNativeAuth` keeps the *native* Firebase SDK out of the auth state so the JS SDK stays the single source of
truth. Apple's `credential.nonce` is the **raw** nonce (the plugin sends `sha256(nonce)` to Apple), which is
exactly what `OAuthProvider('apple.com').credential({ idToken, rawNonce })` wants.

**Requires:** the Firebase **iOS app** (`com.littlecubby.app` in project `little-log-a9caa`) →
`GoogleService-Info.plist`. Park it at **`native-build/GoogleService-Info.plist`** (gitignored — the Worker
serves the whole repo); `tools/cap_ios_configure.rb` copies it in and bundles it. Info.plist needs the
`REVERSED_CLIENT_ID` URL scheme (set by the PlistBuddy step, re-apply if Info.plist is regenerated) and
`FirebaseApp.configure()` must run in `AppDelegate.swift`.

> **Never remove the auth layer to "unblock" a test build.** The wrapper remote-loads `little-cubby.com/app/`,
> so there is no separate TestFlight copy — removing auth removes it for every web user. And without
> `request.auth` the Firestore rules return nothing, so an auth-less build is an empty shell. The only way to
> show real data unauthenticated is to open the rules, which would expose every family's private health log.
> Never. If a signed-out preview is genuinely needed (e.g. for Apple review), build a native-gated demo mode
> on seeded fake data instead, or hand review a demo account.

## 3e. What WKWebView silently breaks (audit these before claiming "100% of the PWA")
A wrapper is not Safari. These fail **silently** — no error, the button just does nothing — so they will
not show up in any smoke test that only checks for exceptions. Found and fixed 2026-07-16 (sw v192):

| API | In WKWebView | Cubby's fix |
|---|---|---|
| `a.download` | **ignored entirely** | `saveFile()` → `Filesystem.writeFile` + `Share.share` (OS share sheet) |
| `window.print()` | no-op | `openPrintable()` → shareable report file |
| `window.open('','_blank')` | returns **null** | `openPrintable()` branches before it |
| `navigator.share` | **absent** | existing clipboard/`saveFile` fallbacks now reach the native sheet |
| Service Worker | unavailable without `WKAppBoundDomains` | declared + `limitsNavigationsToAppBoundDomains` — **VERIFIED on the simulator** |

`a.download` had **nine** call sites (keepsake cards, named cards, moment photos, saved photos, video
export, data export, `.ics`). All were dead in builds 1–3. `window.print()` powered the **doctor report**,
which is the Pro anchor. Everything now routes through `saveFile()` / `openPrintable()` in `app/index.html`,
which delegate to `window.cubbyNativeSaveFile` (`app/native-bridge.js`) only when it exists — the web path
is byte-for-byte unchanged and asserted by the native smoke.

### Offline / Service Workers — RESOLVED and measured (build 5)
WKWebView does not expose Service Workers unless the app declares `WKAppBoundDomains`, so builds 1–4 had **no
SW: no offline, no cached launch** — strictly worse than the website they wrap. Now declared
(`little-cubby.com`, in `tools/cap_ios_configure.rb`) and paired with
`ios.limitsNavigationsToAppBoundDomains: true`, which is **mandatory**: with the key present but the flag
false, WebKit restricts script injection and Capacitor's own bridge breaks.

The feared side effect (the webview may not navigate outside the listed domains) is affordable *because*
sign-in is now native and articles/off-site links open in a separate process (`Browser.open` /
UIApplication). This change would NOT have been safe before §3c.

**Verified on the iPhone 17 Pro simulator, not assumed** — the three things that had to be true:
```
WebPageProxy::decidePolicyForNavigationAction: policyAction=Use, isAppBoundDomain=1   # allowed, and IS app-bound
ServiceWorkerContainer::addRegistration: Registering service worker. jobID=230        # SW registers
ServiceWorkerContainer::jobFinishedLoadingScript: Successfuly finished fetching script # its script loads
```
plus `.../WebsiteData/Default/<origin>/ServiceWorkers/ServiceWorkerRegistrations-8.sqlite3` on disk, and a
screenshot showing the **native** landing (no marketing nav, no install CTA) — which proves the Capacitor
bridge still injects under app-bound domains, the actual risk.

How to re-check after any native change:
```bash
xcrun simctl boot <UDID>; xcrun simctl install <UDID> <App.app>; xcrun simctl launch <UDID> com.littlecubby.app
# the sim needs ~20s to commit the remote page — screenshotting earlier shows a blank cream screen
xcrun simctl spawn <UDID> log show --last 3m --predicate 'processImagePath CONTAINS "App"' --style compact \
  | grep -iE "serviceworker|isAppBoundDomain"
```
> **Watch the disk.** An archive + a simulator build cost ~4GB of `/tmp` and this Mac runs near full; a full
> disk shows up as a blank webview and "No space left on device" from unrelated commands. `rm -rf
> /tmp/cubby-dd /tmp/cubby-sim` and `xcrun simctl erase <UDID>` when done.

## 3d. What the wrapper must hide (a wrapper has no browser chrome)
Verified by a 27-assertion smoke that boots `/app/` with and without a faked Capacitor bridge
(`scratchpad/native-smoke.js`; run with `NODE_PATH=<repo>/tools/node_modules`, where puppeteer-core lives):
- `canShowInstall()` vetoes on `isNativeApp()` — the wrapper IS a WKWebView, so `isWebView()` is true and an
  installed app was offering to install itself.
- `app/landing.js` drops the marketing nav + footer links on native: they navigate the webview off `/app/`
  and strand the user with **no back button**.
- It also drops the Pro/pricing block on native — **App Review 3.1.1**: no pointing at a subscription bought
  outside IAP (Pro is register-interest until Aug 2026 anyway).
- Same-origin `target="_blank"` links (the article reads) route to `Browser.open` (in-app sheet with a Done
  button) instead of ejecting to Safari. Off-site links still get the system browser.

## 4. Icons + splash 🖥️
**App icon: DONE (build 3).** `npx cap add ios` ships a **placeholder** (Capacitor's blue X) — builds 1 and 2
carried it, which would fail review and looks broken to testers. `python3 tools/gen_app_icon.py` builds the
required 1024×1024 from `icons/logo-512.png`. It is **not** a plain resize, because Apple demands the icon be
**square and opaque** (no alpha, no pre-rounded corners — iOS applies its own squircle mask, so a pre-rounded
icon gets double-rounded and an alpha channel is an outright rejection), while our source is a 512 rounded
rect *with* alpha and there is no vector original. So the script:
- erodes the anti-aliased boundary fringe (whose alpha rounds to 255 but whose colour blends toward white —
  left in, it skews the fit and paints a bright arc where the old corner was),
- fits the cream background gradient from the artwork's own opaque border pixels with a quadratic surface
  (a plane left 27/255 residuals and a visible seam; the quadratic gets max **0.7/255**),
- renders that gradient full-bleed to the corners, composites the 2× Lanczos bear, flattens to RGB.

Re-run it after any `cap add ios` (the icon lives under gitignored `ios/`). If a true 1024 or vector bear ever
exists, drop it at `icons/logo-1024.png` and the script prefers it automatically — the current icon is an
honest upscale of 512 art, which is the one quality compromise in the build.

**Splash: DONE (build 8).** `python3 tools/gen_splash.py` — segments the bear out of `icons/logo-512.png`
(flood fill against the fitted tile gradient, so the enclosed cream muzzle survives) and composites it at the
optical centre of a flat `#F7F2E8` 2732×2732, written to all three `Splash.imageset` scales. Before this,
every launch flashed Capacitor's blue X on white. Same durability rule as the icon: re-run after `cap add ios`.

## 5. Push notifications (the reason iOS users need this) 🖥️
Web push on iOS only works if the PWA is installed; the wrapper gives reliable APNs push.
**DONE:** the Firebase **iOS app** (`com.littlecubby.app`, project `little-log-a9caa`) exists and its
`GoogleService-Info.plist` is bundled (§3c — native sign-in needed it too).
**REMAINING:**
1. **APNs key**: Apple Developer → Keys → new key with **Apple Push Notifications service (APNs)** enabled →
   download the `.p8` → move to `~/.appstore-keys/` (never commit; `*.p8` is gitignored). The Sign-in key
   `78HP3BF2S5` is a *different* key — make a separate APNs one.
2. **Firebase** → Cloud Messaging → upload that `.p8` with its Key ID + Team ID `F5NVQV7NVB`.
3. Enable the **Push Notifications** capability: add `aps-environment` to `ios/App/App/App.entitlements` via
   `tools/cap_ios_configure.rb` (NOT by hand in Xcode — `ios/` is regenerated). The App ID must have the Push
   capability enabled first, or provisioning fails at export.
4. **DONE (build 5) — but note `@capacitor/push-notifications` gives the wrong kind of token.** On iOS its
   `registration` event returns the raw **APNs device token**. Cubby's existing push path is **FCM**: the web
   stores `users/{uid}.push.tokens[<FCM token>]` (`enablePush()` in `app/index.html`) and the Worker cron
   reads that map and sends via the FCM API. Handing it an APNs token would simply fail to deliver. Use
   **`@capacitor-firebase/messaging`** instead — it wraps the native Firebase Messaging SDK, so `getToken()`
   returns a real **FCM registration token** that drops straight into the same map, and the Worker, the quiet
   hours, the `push.due` index and the whole medicine-reminder pipeline keep working unchanged. Then
   `app/native-bridge.js` calls `window.onNativePushToken(token, platform)`; implement that hook to write the
   token exactly where `enablePush()` does. Note `pushSupported()` (index.html) gates on
   `firebase.messaging.isSupported()` + `Notification in window`, which is false in the wrapper — the
   Reminders sheet needs a native branch that calls `cubbyEnableNativePush()` instead.
   Android: add the Firebase Android app + `google-services.json`.
   **Uninstall `@capacitor/push-notifications` once messaging is in** — both plugins swizzle the APNs
   delegate and having them side by side is a real conflict. The config block is `FirebaseMessaging`, not
   `PushNotifications`.

**Policy (do not regress):** the bridge deliberately does **not** ask for push permission on launch — it only
`checkPermissions()` and re-registers if already granted, and exposes `window.cubbyEnableNativePush()` for the
medicine-reminder toggle to call **in context**. A cold OS permission dialog in front of a parent who hasn't
signed in yet is exactly the anxiety the charter designs out, and Cubby's push policy is critical-only.

## 6. Avoid the Apple 4.2 rejection
- Ship push (above), the native splash, and status‑bar theming — concrete native value.
- App Store description must sell the *app experience* (offline, reminders, shared caregiver log), not "our website in an app".
- Have real content on first launch (it does).
- Sign in with Apple is already supported → good signal.

## 7. Build + upload — iOS 🖥️

**The entry point is `bash tools/cap_ios_build.sh`** (add `--local` to export an IPA without uploading). It runs
configure + icon + splash, archives unsigned, **hand-signs the .app with the entitlements** (aborting if
`applesignin`/`aps-environment` are missing), gates on 0 fbsdk strings, then exports/uploads. Do NOT run the raw
commands below on their own: archiving with `CODE_SIGNING_ALLOWED=NO` and exporting directly ships an app with
NO entitlements — that broke builds 1-5 and again build 8 (2026-08-02). The commands are kept for understanding
what the script does:

```bash
# 1. Archive UNSIGNED. Archiving WITH automatic signing FAILS ("Your team has no devices from which to
#    generate a provisioning profile") because it wants an iOS App *Development* profile. Sign at export
#    instead — the App Store profile needs no registered device.
rm -rf /tmp/Cubby.xcarchive
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath /tmp/Cubby.xcarchive \
  -derivedDataPath /tmp/cubby-dd \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO archive

# 2. Sign + upload. MUST use the ADMIN key 33AU4Z9QJ4 — the App-Manager key 45N9W4NQT2 fails with
#    "Cloud signing permission error / No signing certificate iOS Distribution found" (only Admin keys
#    can mint the cloud distribution cert).
xcodebuild -exportArchive -archivePath /tmp/Cubby.xcarchive \
  -exportOptionsPlist native-build/ExportOptions.plist -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstore-keys/AuthKey_33AU4Z9QJ4.p8 \
  -authenticationKeyID 33AU4Z9QJ4 \
  -authenticationKeyIssuerID 6b58eca9-6e61-450a-8b7c-f49fcb03a7e6 \
  -exportPath /tmp/Cubby-export
```
Success looks like `Upload succeeded` / `Uploaded App` / `** EXPORT SUCCEEDED **`. With
`destination: upload` **no local IPA is written** (`/tmp/Cubby-export` stays empty — normal).
`manageAppVersionAndBuildNumber: true` auto-bumps the build number, so no version editing between uploads.

Check processing state without opening a browser: `node scratchpad/asc.js` (App Store Connect API, read-only;
app id `6791454709`). `state=VALID` = installable in TestFlight.

Because the wrapper **remote-loads** `little-cubby.com/app/`, **deploy the web first** (`sw.js` CACHE bump →
push to `main` → poll the live `sw.js`), or the new build will load the old JS.

Then: TestFlight for the WhatsApp crew (external testers need a one-time Beta App Review, ~24h), then
**Submit for Review** (≈1–3 days).

**macOS gotchas that cost an hour:** a `.p8` downloaded by Safari into `~/Downloads` is Safari-scoped
(`com.apple.macl`) → every read/copy/xattr is "Operation not permitted" even with the sandbox off. Fix: Full
Disk Access ON for **both** `claude` rows, then **fully quit and relaunch** (TCC only applies on app restart;
toggling it mid-session revokes the running process's access to everything, including the repo). Keys live in
`~/.appstore-keys/` (chmod 600, outside the repo) and `*.p8` is gitignored — a committed key would be public
at `little-cubby.com/AuthKey_*.p8`.

## 8. Build + submit — Android 🖥️
```bash
npx cap open android  # Android Studio → Build → Generate Signed Bundle (.aab)
```
Play Console: create the app, upload the `.aab`, fill the listing + **Data safety** form, set content rating, roll out to internal testing → production. Note the newer **personal‑account rule**: 20 testers for 14 days before production (an org account skips this). Review ≈ hours–2 days.

## 9. Store‑listing assets checklist
- **Name:** Cubby — Baby & Pregnancy. **Subtitle:** the calm, shared tracker.
- **Screenshots:** iPhone 6.7" + 6.5" (required), iPad optional; Android phone. Capture from the real app (Home, Care/record, Moments, a quick‑read carousel).
- **Description + keywords** (reuse marketing copy; truthful‑copy rule).
- **Privacy policy URL:** `https://little-cubby.com/privacy/` (exists).
- **App Privacy (Apple) / Data safety (Google):** answer from Cubby's real practices — health data stored in Firebase, **no third‑party trackers/ads**, mother‑owned private health, data shared only with the user's circle by consent. Do **not** over‑claim.
- **Age rating:** 4+ / Everyone.
- **Category:** Health & Fitness (or Lifestyle).
- Free app; no IAP yet (Pro is register‑interest until Aug → add IAP later, which is when banking/entity actually matters).

## 10. Ongoing
- Option A: PWA changes deploy via Cloudflare as now, **no re‑submit**. Only native/shell changes (new plugin, icon, config) need a new build + review.
- Keep the `.p8` / plists / signing certs **out of git** (like the service‑account key).

## What Claude can do next
- Prep the exact `capacitor.config`, the Capacitor‑detection + push‑registration shim in `app/`, and generate the icon/splash source once we have a 1024 bear.
- Walk you through §3–§8 live when you're at the Mac.
Cannot: archive/sign/upload, log into Apple, or clear review — those are yours.
