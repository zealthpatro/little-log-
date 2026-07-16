# Getting Cubby into the App Store + Play Store (Capacitor wrapper)

**Goal:** a one‑tap install on iPhone (and a Play Store listing) that reuses 100% of the existing PWA. No rewrite.
**Why Capacitor, not TWA:** TWA is Android‑only. Capacitor wraps the *same* web app for **both** iOS and Android.
**Status (2026-07-16):** **build 2 uploaded and VALID in TestFlight**, with native Google + Apple sign-in.
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
Use `@capacitor/assets`:
```bash
npm i -D @capacitor/assets
mkdir -p assets
cp icons/logo-512.png assets/icon.png            # 1024x1024 ideal — upscale/redraw if needed
# create assets/splash.png (2732x2732, bear on #F7F2E8)
npx capacitor-assets generate --iconBackgroundColor "#F7F2E8" --splashBackgroundColor "#F7F2E8"
```
> TODO before submit: a 1024×1024 icon (Apple requires it) and a 2732×2732 splash. The current 512 icons are too small — regenerate at 1024 from the bear art.

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
4. Wire the token: `app/native-bridge.js` already registers and calls `window.onNativePushToken(token,
   platform)`. Implement that hook to store the token the same way the web FCM token is stored, so the
   existing Worker cron delivers to it. Android: add the Firebase Android app + `google-services.json`.

**Policy (do not regress):** the bridge deliberately does **not** ask for push permission on launch — it only
`checkPermissions()` and re-registers if already granted, and exposes `window.cubbyEnableNativePush()` for the
medicine-reminder toggle to call **in context**. A cold OS permission dialog in front of a parent who hasn't
signed in yet is exactly the anxiety the charter designs out, and Cubby's push policy is critical-only.

## 6. Avoid the Apple 4.2 rejection
- Ship push (above), the native splash, and status‑bar theming — concrete native value.
- App Store description must sell the *app experience* (offline, reminders, shared caregiver log), not "our website in an app".
- Have real content on first launch (it does).
- Sign in with Apple is already supported → good signal.

## 7. Build + upload — iOS 🖥️ (WORKING RECIPE — this is what shipped builds 1 and 2)
No Xcode GUI needed. Two commands from the repo root:

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
