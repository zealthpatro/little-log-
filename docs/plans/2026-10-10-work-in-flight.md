# Work in flight: 10 October 2026

What every open Cubby session was doing, what reached main, what is stranded, and what waits on the
founder. Built from a read-only inventory of all 17 open sessions (their transcripts, read through the
app's session list) and every branch not merged into origin/main. Keep this file current: every session
starts by checking it (memory: feedback_kickoff_scan_and_sync), and finished work gets merged, not left
in a worktree.

Main at the time of writing: acd61c21 (Pro date). This file ships in the same push as 83ce2d7a,
474c0024 and af7d0312 below.

## 1. Landed this week

| Commit | What |
|---|---|
| f4f0ed0d | Gates no longer save calendar files into ~/Downloads; a guard fails any gate that does |
| 9f5fdba6 | A manual deploy can no longer publish the App Store keys and API keys (.assetsignore + walk gate) |
| acd61c21 | Pro launch date moved to January 2027 everywhere a parent or crawler reads it (26 places) |
| 83ce2d7a | The weekly health report runs again, from ~/cubby-ops/little-log-pwa (this push) |
| 474c0024 | The app-build session's design spec merged from its branch (this push) |
| af7d0312 | Medicine doses, units, readings and severities escaped at eleven sites, ported from 22 Aug (this push) |

## 2. Unfinished code, by risk

1. **Medicine dose escaping: ported, in this push (af7d0312).** The original uncommitted copy is still in
   worktree `charming-allen-1549c4`; it can be cleaned up once this lands, with the founder's yes.
2. **Onclick id escaping (stored script injection).** Member-chosen document ids reached inline
   handlers. Confirmed on the emulator 6 Oct. Fix UNCOMMITTED in worktree `dazzling-moore-1db738`
   (safeId at ~210 sites, corrected jArg, store filter for events, notes, photos), plus
   `test/handler-id-xss.test.js` (red before the fix, not yet re-run green). Missing: the permanent
   static gate (could not be written in that session; founder's call how to finish), wiring, CACHE
   bump, postmortem.
3. **Dose-ticket membership hole (Worker).** Commit 5ff47736 on branch
   `claude/charming-chatterjee-dd4a40`: a signed-in stranger could log a dose into another family.
   Related gates green (dose-membership 86/86); full suite not yet run. **Needs the founder's yes**
   because it deploys to the live Worker, then a read-only production audit of whether the hole was used.
4. **Remote config and anchored home widgets.** UNCOMMITTED in `~/cubby-worktrees/config-anchors`.
   One read-only Firestore document (config/app) for Pro dates and prices, rollout switches and home
   widget order; locked safety widgets cannot be hidden. 24 of 105 gates passed before the run was
   paused. Missing: full suite, a config gate, an operator writer, CACHE bump. Rules deploy separately.
   Decision record: `docs/plans/2026-10-09-ADR-001-sdui.md`.

## 3. Branches not merged into main

| Branch | Verdict |
|---|---|
| `claude/weekly-report-fix` | This push: the weekly fix, the spec merge, the dose escaping and these docs |
| `claude/cubby-mode-app-build-effc9f` | Merged in this push (474c0024; only the design spec was new), founder said yes on 10 Oct |
| `claude/charming-chatterjee-dd4a40` | Dose-ticket fix, see 2.3, waits on the founder |
| `marketing-three-surfaces` (+ two `mig/` copies) | June articles-hub edit; the hub has changed heavily since. Superseded unless the founder says otherwise |
| `origin/claude/options-trading-strategy-growth-c8oyso` | **Not Cubby** (trading). Never merge here; the founder decides where it belongs |

## 4. Designed, not built

- **Home-screen widget suite**: 15 boards and a 10-item decisions note on the canvas
  https://claude.ai/artifact/5uT24tX7nHpn1MSxGQKhWm (Cubbydesign, 6 Oct). Not in the repo; the board
  sources lived in a scratch folder that no longer exists. iOS-first; no PWA equivalent drawn, which is a
  parity question (section 6). Waits on the founder's approval.
- **iPhone Duo** (ships 23 Oct): add 626x890 and 466x678 to the gate sweep, side safe areas. Offered,
  not started.

## 5. Waiting on the founder

- Push the dose-ticket fix (2.3), and run the production audit after.
- How to finish the onclick-id fix's permanent gate (2.2).
- Approve or change the widget boards and their 10 decisions (4).
- Hide every Pro surface in builds without StoreKit before App Store submission, or submit with the
  truthful review note (App Review 3.1.1; see 6.16).
- App Store submission inputs: review contact, demo account, App Privacy answers (Usage Data was answered
  wrongly), then the irreversible submit.
- Terms and six articles still describe Pro as on sale now (task queued; the Terms change needs a yes).
- Secrets: `wrangler secret put INTERNAL_UIDS` and `ALERT_EMAIL` (state unknown), rotate the art-src
  OpenAI and Gemini keys, decide on the duplicate .p8 files in `credentials/`.
- Cloudflare Web Analytics is still injecting a third-party script on six surfaces including /privacy/,
  against the no-third-party promise: switch it off in the Cloudflare dashboard.
- Privacy policy still names the controller as "[Legal entity — to be confirmed]".
- Housekeeping: 21 leftover gate .ics files in ~/Downloads (Trash?), about 61 leftover workflow worktrees
  (delete only with a yes, after checking live sessions), the repo itself living in ~/Downloads.

## 6. PWA vs app: every difference in code

The app is a Capacitor shell that loads the live /app/, so every difference is an explicit native check.
No gate checks web-vs-app parity today: `tools/android_parity_check.js` covers the iOS vs Android shells
only and is not wired into `tools/gates.js` (7 passed, 6 failed on 31 Aug).

Forced by the platform (keep, but keep listed):
1. Signed-out screen: compact sign-in in the app, full marketing landing on the web (no back button in the app).
3. FAQ link hidden in the app and installed PWA (it would replace the app with no way back).
4. Google and Apple sign-in use native sheets in the app (web OAuth fails inside WKWebView).
6. Install instructions differ by browser (web only).
7. Installed iOS PWA told to use Safari if sign-in stalls (separate storage container).
8. Reminders: web push on the web; in the app only from build 2026.33 (older builds had a dev APNs entitlement).
9. Desktop and Android browsers can raise an OS notification for a due dose; the app uses a toast and haptic.
10. Haptics in the app; vibration on Android web; nothing on iOS web.
11-14. Saving files and reports: share sheet in the app (WKWebView ignores downloads and print); download or print on the web, with different button and toast words.
15. Some shares rely on navigator.share, which WKWebView may lack, so invite button wording can differ. The repo's own comments disagree about WKWebView here: verify on a device.
17. Status bar follows Night mode in the app.
18. Links open in an in-app browser sheet in the app; a new tab on the web.
19. Deep links and notification taps routed through sessionStorage in the app.
20. Android hardware back button handled in the app.
22. Voice logging depends on speech recognition being exposed; in the app this is unverified.

Not forced, so they are founder decisions:
2. Apple button above Google on iOS only.
5. Every "add to home screen" prompt hidden in the app (correct, it is already installed).
16. **The Pro sheet shows the price inside the app while the sign-in screen hides pricing for App Review 3.1.1.** Inconsistent within the app itself.
21. Native splash and an offline "Opening Cubby" shell in the app only.
23. Account deletion clears the push token natively; the web does not delete its messaging token.
24. ROLLOUT 'native' stage exists for app-first features; empty today.

Not a code difference but a product one: the widget suite (4) is iOS-first with no PWA equivalent drawn,
and iOS app-icon quick actions are parked while Android and desktop already have shortcuts.

## 7. Other projects seen in this repo's orbit

- `origin/claude/options-trading-strategy-growth-c8oyso`: trading work on Cubby's remote.
- `~/Downloads/zealth/`: Zealth, a separate regulated health-record product, unversioned, from a session
  forked off Cubby on 16 Aug.
- Session "Chat and context preservation setup" runs from ~/Claude folder (machine-migration hub).
