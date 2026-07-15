# Getting Cubby into the App Store + Play Store (Capacitor wrapper)

**Goal:** a one‑tap install on iPhone (and a Play Store listing) that reuses 100% of the existing PWA. No rewrite.
**Why Capacitor, not TWA:** TWA is Android‑only. Capacitor wraps the *same* web app for **both** iOS and Android.
**Status:** runbook ready. Steps marked 🖥️ must run on the founder's Mac (Xcode + Apple login). Claude can prep config/assets and walk through it live, but cannot archive/sign/submit or clear Apple review.

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
Run from the repo root:
```bash
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/ios @capacitor/android @capacitor/app @capacitor/splash-screen @capacitor/status-bar @capacitor/push-notifications
npx cap init "Cubby" "com.littlecubby.app" --web-dir="cap-web"
mkdir -p cap-web && printf '<!doctype html><meta http-equiv="refresh" content="0; url=https://little-cubby.com/app/">' > cap-web/index.html
```
(`cap-web` is a throwaway dir so `cap init` is happy; the real content comes from `server.url` below.)

`capacitor.config.json` (option A):
```json
{
  "appId": "com.littlecubby.app",
  "appName": "Cubby",
  "webDir": "cap-web",
  "server": { "url": "https://little-cubby.com/app/", "cleartext": false },
  "ios": { "contentInset": "always" },
  "plugins": {
    "SplashScreen": { "launchShowDuration": 800, "backgroundColor": "#F7F2E8", "showSpinner": false },
    "PushNotifications": { "presentationOptions": ["badge", "sound", "alert"] }
  }
}
```
Then:
```bash
npx cap add ios
npx cap add android
npx cap sync
```

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
1. **APNs key**: Apple Developer → Keys → create a key with **Apple Push Notifications service (APNs)** enabled → download the `.p8` (never commit it). You already have a Sign‑in key (`78HP3BF2S5`); make a **separate** APNs key.
2. **Firebase**: add an **iOS app** (`com.littlecubby.app`) to project `little-log-a9caa`, upload the APNs `.p8` (Key ID + Team ID `F5NVQV7NVB`) under Cloud Messaging. Download `GoogleService-Info.plist` → drop into the Xcode project.
3. In the web app, when running inside Capacitor, register with `@capacitor/push-notifications` and hand the token to your existing FCM/Worker flow (detect Capacitor via `window.Capacitor?.isNativePlatform`). Android: add the Firebase Android app + `google-services.json`.
4. Enable the **Push Notifications** capability in Xcode → Signing & Capabilities. Also add **Associated Domains** later if you want universal links (`applinks:little-cubby.com`) so `?go=`/`?read=` deep links open the installed app.

## 6. Avoid the Apple 4.2 rejection
- Ship push (above), the native splash, and status‑bar theming — concrete native value.
- App Store description must sell the *app experience* (offline, reminders, shared caregiver log), not "our website in an app".
- Have real content on first launch (it does).
- Sign in with Apple is already supported → good signal.

## 7. Build + submit — iOS 🖥️
```bash
npx cap open ios      # opens Xcode
```
In Xcode: set the Team (`F5NVQV7NVB`), bump version/build, Product → Archive → Distribute → App Store Connect → Upload. Then in **App Store Connect**: create the app record (`com.littlecubby.app`), fill the listing (§9), attach the build, submit to **TestFlight** first (dogfood with the WhatsApp beta users), then **Submit for Review**. Review ≈ 1–3 days.

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
