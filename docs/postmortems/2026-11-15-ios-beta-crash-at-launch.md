# Post-mortem: the iPhone beta closed itself at launch

- **Date:** 2026-11-15
- **Severity:** P1 (every TestFlight install of the native app; no App Store customers yet)
- **Duration:** TestFlight 2026.46.1 uploaded 15 Nov → fixed build 2026.47.1 in beta testing 16 Nov (00:24 +04). It is 47.1, not 46.2: the build script stamps the ISO week, and the week turned at midnight.
- **Status:** RESOLVED. 2026.47.1 carries the fix; its launch smoke stayed up 12 s on the iOS 27 simulator before upload.
- **Author:** Claude (main window), with the founder's crash report

> Blameless. Dates come from `node tools/asc.js builds`, the Xcode bundle's install time and the
> TestFlight crash log, not from memory.

## What happened
The founder installed TestFlight 2026.46.1 and it closed the moment it opened, every time. The
TestFlight crash log (`/betaFeedbackCrashSubmissions/{id}/crashLog`) showed `EXC_BREAKPOINT` in
UIKit's `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, called from
`UIApplicationMain` at `AppDelegate.swift:7`, on iPhone OS 27.0. The same crash reproduced on an
iOS 27 simulator with a Debug build, so it was not signing, entitlements or the device.

## Impact
Nobody could open the native beta. The website and the home-screen PWA were untouched: the native
app is a shell around `https://little-cubby.com/app/`, and the crash happened before it loaded
anything. No data was at risk, because the app never got as far as signing in.

## Root cause
iOS 27 enforces the UIScene lifecycle for apps built with the iOS 27 SDK: an app whose Info.plist
has no `UIApplicationSceneManifest` is stopped by UIKit at launch. Xcode 27.2 was installed on 30
Oct, so 2026.46.1 was the first build made with the iOS 27 SDK (the build before it, 13 Aug, used
the iOS 26 SDK). Capacitor 8.4's `cap add ios` template still generates an app-delegate-only
project, and `tools/cap_ios_configure.rb` patched everything else about it, but not that.

## 5 Whys
1. **Why did the app close at launch?** UIKit trapped on purpose: the app had not adopted scenes.
2. **Why had it not?** The Xcode project comes from Capacitor's template, which has no scene
   delegate or scene manifest, and nothing in our configure step added one.
3. **Why did that only bite now?** iOS 26 SDK builds were allowed to skip scenes; the first iOS 27
   SDK build (Xcode 27.2, installed 30 Oct) was not, and it went straight to TestFlight.
4. **Why did no check catch it before upload?** Every check in `cap_ios_build.sh` inspects the
   archive (entitlements, aps value, no Meta SDK). None of them ever launched the app.
5. **Why not?** "Does the archive contain X?" was the question each check asked, never "what does
   this build do when someone taps the icon?" → **Root cause: no launch test between a toolchain
   change and an upload.**

## Contributing factors (blameless)
- The export step printed `EXPORT FAILED` and still exited 0 (`| grep … || true`), so the earlier
  agreement-expired failure that same day also looked like a finished build.
- Crash logs only reached us because the founder reported the crash. Nothing polls TestFlight crash
  submissions yet.

## What fixed it
- `tools/cap_ios_configure.rb` step 6: writes `SceneDelegate.swift` (links that launch or reach the
  app go to Firebase Auth first, then Capacitor, exactly as `AppDelegate` did), declares the scene
  manifest with `Main.storyboard`, compiles the delegate into the App target, and reads each part
  back, aborting on a miss.
- `tools/ios_launch_smoke.sh`: builds for the newest iOS simulator, launches, and fails unless the
  app is still running after 12 seconds with no new crash report. `cap_ios_build.sh` runs it before
  archiving. Seen red on the unpatched project (it printed the same UIKit frame as TestFlight) and
  green on the patched one (alive, sign-in screen on screen).
- `cap_ios_build.sh` now fails unless the export log says it succeeded.

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | Scene lifecycle in `cap_ios_configure.rb` | Fix | DONE |
| 2 | Launch gate before every archive (`ios_launch_smoke.sh`) | Prevent | DONE |
| 3 | Export failure is a failure | Prevent | DONE |
| 4 | Poll TestFlight and App Store crash reports, classify, alert, open a fix session | Prevent | TODO (queued) |

## Lessons
- A new Xcode is a new set of launch rules. The first build after one must be launched, not just
  archived.
- The question that found it: "what does this build do when someone taps the icon?"
