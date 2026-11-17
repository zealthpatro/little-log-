# Home-screen widgets on iPhone and Android: design

Date: 16 Nov 2026. Status: approved by the founder (decisions below), revised the same day after a four-lens review
(69 items, logged at the end). The six questions that were his are answered (F1 to F6 below; section 10 keeps the reasoning). Not yet planned or built.
Audience: the engineer who plans and builds this without asking the founder.
Sources: design/components/cubby-components.html (SPEC, approved 29 Sep), docs/plans/2026-09-26-ios-widgets-verdict.md (IOSV),
docs/plans/2026-09-30-pro-gating-widgets-verdict.md (PRO), docs/plans/2026-08-21-live-activities-verdict.md (LAV),
docs/plans/2026-08-31-multiplatform-launch-readiness.md (MPL), and five read-only grounding passes over this tree on 16 Nov.
Line numbers are for this worktree at 58733b16. Re-check them before editing; several older docs already drifted.
"Builder call (16 Nov, id)" marks a choice made to settle a review item. The founder can scan for that phrase.
"UX pass (16 Nov)" marks a change from the later design, copy and UX review of this doc and the 16 Nov board (23
findings, logged at the end). Widths were measured in Cubby's own Nunito Sans and Fraunces; where a UX pass overrides an
earlier builder call, it says so.

## Founder decisions, 16 November

Fixed. Plan and build to them; do not reopen them. Every "D1" to "D8" and "C1" to "C7" in this doc points here.

- D1. iPhone and Android both get native widgets. No Kotlin Multiplatform. One shared source keeps them in step (6.11).
- D2. The four approved variants: post-birth medium, post-birth small, lock screen (iOS only), and pregnancy, which is
  quiet by default (SPEC, approved 29 Sep).
- D3. Twins: a per-widget baby picker (each baby, or both); a twins layout for two-baby families; on iOS, stacks give
  swiping. No scrolling widget, no switch button.
- D4. Medium buttons: Feed, Sleep and Nappy are fixed; the fourth is the parent's pick. The fourth becomes Health while an
  illness is open and goes back after; with twins it goes to the ill twin directly. Nothing about the illness on glass.
- D5. Twins: every button defaults to Both. Health is always per baby.
- D6. Approach B: every tap opens Cubby on its sheet with the baby, or Both, already picked, except Sleep, which starts and
  stops in place through one Worker endpoint both platforms call. Approach C (in-place guesses) is rejected. Order: A
  first, B right after.
- D7. Edit Widget holds which baby (or both) and the fourth button. Nothing else.
- D8. No PostHog, no Sentry: first-party measurement only.

Carried from the 6 October canvas decisions (Suite boards, https://claude.ai/artifact/5uT24tX7nHpn1MSxGQKhWm, sticky
n-decide):
- C1. The clock time is the headline number; the "ago" line under it is drawn live by iOS.
- C2. No ticking nap counter on the home screen. Show when the nap started: "Asleep now, since 2:40 AM".
- C3. An offline tap says so and opens Cubby. Nothing is queued for later.
- C4. Logging naps from a widget means running naps move into their own server record, which touches every family's
  sleep logging.
- C5. Refreshing every phone needs an Apple push key.
- C6. Dose reminders stop naming the medicine on the lock screen.
- C7. While a baby is unwell, Temperature, Symptom and Medicine open Cubby.

Label. The button is "Sleep": it matches QUICK_ACTIONS and the PWA manifest, and tools/shortcuts_check.js asserts
manifest name === QUICK_ACTIONS label. Phase A binary: "Sleep" with the opens-Cubby arrow. Phase B binary: "Start sleep"
/ "Stop sleep". "Nap" is never a button label; "nap" stays only in prose about the event. The founder confirmed Sleep (F6).

Answers to the six open questions, 16 November (the reasoning stays in section 10):
- F1. Release order: iOS first. The app goes to App Review as it is now, without widgets. Phases A and B ship together
  in the next iOS update, with F2. Android follows the moment its shell signs in (Play account, upload keystore and
  Firebase Android app are the founder's); the parity gate allows a declared iOS-only window.
- F2. The partner's 3am log reaches this phone's widget: a server snapshot pull plus a silent push poke (6.9). It ships in
  the same iOS update as A and B, and needs the Apple push key (C5).
- F3. After a pregnancy loss in a family with a living child, the widgets keep that child's times and Sleep button, as
  Home does. Nothing pregnancy-related appears on glass, in long-press shortcuts or in the gallery.
- F4. The pregnancy widget is held until the carrier handover (CA3, "Who's carrying?", designed 27 Oct in
  docs/plans/2026-10-27-carrier-and-handover-design.md, not built) and F2's server path both exist, so only she can turn it
  on and a loss recorded anywhere clears it. Its kind is not compiled until then; pregnancy shows no shortcuts until then.
- F5. The Health switch stays automatic (D4), and Health also returns to the parent's pick after 14 days with no illness
  entry for that baby.
- F6. The label is "Sleep": "Start sleep" / "Stop sleep".

Added 17 November, after the founder reviewed the board:
- F7. Who logged it. Every new log records who made it (`by`, the logger's uid): the app's own log paths and the
  Worker's sleep route (the token's uid). A widget shows the logger's circle label after a status ("Last feed · Dad")
  only when that person is not the one holding this phone; your own logs carry no name. Home screen only (medium, twins,
  small); never the lock screen, StandBy or any pregnancy surface. Older entries have no author and show no name. This
  is the 6 October "Parent 1, parent 2 and the nanny" design, which had no data behind it until now (6.6).
- F8. Foldables are first-class: iPhone Duo and Galaxy Z Fold-type phones. Small and medium are checked folded and
  unfolded; Android widgets use responsive sizes. A large "night's story" widget for the unfolded screen is later, not
  this cycle.
- F9. The small widget carries two buttons the parent picks (this extends D7 for the small widget only): any two of
  Feed, Sleep, Nappy, Activity, Health, Pump (Say it on Android only, per 6.2). Default: Sleep, then Feed. Sleep keeps its
  in-place behaviour on the small widget. While an illness is open the second button becomes Health, unless Health is
  already one of the two; it goes back as on the medium (F5).
- F10. Month days (chosen 17 Nov from the Sandbox options; "plus marked firsts" was not chosen). On a baby's month day
  the widget celebrates in one place only: the medium header's age line "2 months old" becomes "3 months today" (honey
  ink with a small star), the small widget's label line becomes "Robin · 3 months today", and twins share one line
  ("Robin and Wren · 3 months today") when both have the day. Times, statuses and buttons never move. Month days 1 to
  23, with month 12 reading "1 year today"; from 24 months, once a year ("2 years today"). The day is computed with
  the app's own monthiversary arithmetic (index.html:3309, setMonth from the birth date), only on the exact day: the
  app's Home month card keeps its own 14-day window. A tap on the header (the widget body link that day) opens the
  month card the app already has (openMonthCard, index.html:3077, which opens openMemoryCard with no Pro gate). Home
  screen only: never the lock screen, StandBy, a Mac or the iPad lock screen. Nothing while loss holding is active, even
  with a living child's times on the widget (F3). Free. Counted as widget.opened with target "moment". Same on Android.
  The 6 October version that replaced the times with "Robin is 3 months old today" and "Make a card" is not built.

## 1. Intent

It is 3am. One parent is holding a baby who will not settle and wants one fact: when did she last feed? The other parent
did the 1am feed and is now asleep. Today the answer means unlocking, opening Cubby, waiting for the webview and reading
Home. A widget answers it in one glance at the home screen, and starts or stops sleep in one tap without opening anything.

The two-caregiver handover is Cubby's wedge (Delta-4 audit: the second caregiver is the product), so a widget that only
shows what this phone logged is half a widget. So the partner's 1am feed reaches this phone's glass through the
server (F2), and the widget still says honestly how old its information is.

The bar is the Anxiety Test (CUBBY-EXPERIENCE-CHARTER.md:89-92): every state of every widget ends calmer than it began.
At 3am that means answer in one glance, one tap, never make her hunt, count or interpret (charter:39-42).

## 2. Goals, non-goals, anti-goals

Goals
- G1. The four variants of D2 plus the twins layout (D3), on iPhone and Android, looking and reading the same.
- G2. Every logging button opens Cubby on the right sheet with the right baby (or Both) already picked (D6).
- G3. Sleep starts and stops in place, safely, through one Worker endpoint both platforms call (D6).
- G4. Every widget says how old its data is, and no relative time on glass is a frozen string.
- G5. Long-press app shortcuts on both platforms, stage-aware and dynamic only, from the same source as the widgets.
- G6. iOS and Android cannot drift: one source table, one generator, shared fixtures, gates that go red on drift.
- G7. UX pass (16 Nov): dose reminders stop naming the medicine on the lock screen (C6), shipped in Phase A as its own
  change with its own gate (6.12).

Non-goals (this cycle)
- No in-place logging for anything but Sleep. No "same as last time" guesses (approach C, D6). No offline queue (C3).
- No systemLarge or extraLarge this cycle (F8: the unfolded "night's story" widget is later), no StandBy-specific design, no watchOS, no Control Center controls (IOSV §6, :236, :243).
- No Live Activity. No widget "looks" or themes (PRO:535, :572-575, dropped, not postponed).
- No Android lock-screen or keyguard widget. No tablet-specific layout. No third-party measurement (D8).

Anti-goals. Any of these makes the feature a failure even if every button works.
- Wrong data on glass: another family's baby, the wrong twin's feed, a time computed differently from Home.
- A widget that outs a pregnancy: on a caregiver's phone, on any surface shown without an unlock, after a loss, in the
  trying stage, or before the owner opted in.
- A silent wrong log: a sleep started or stopped that the parent did not mean, or a tap that looked saved and was not.
- A stale number that looks live: "1h 5m ago" that stopped moving, a nap counting to "14h 22m".
- Clinical data on glass: illness names, day counts, temperatures, medicine names, mood (IOSV:238-239).
- iOS and Android drifting: different labels, different buttons, different rules for the same family.
- Anything on a widget that mentions, locks behind, or opens Pro (PRO:392-400).

## 3. Constraints

Platform
- Widgets cannot show pickers, popups, text fields or scroll. Anything needing a choice opens the app.
- Button(intent:) and AppIntentConfiguration (the baby picker) need iOS 17; Lock Screen accessories need 16. The widget
  extension's floor is iOS 17.0; the host app stays at 15.0 (pbxproj:243, 294, 313, 339).
- An AppIntent that opens the app hands the webview no URL, and OpenURLIntent needs iOS 18. So every opens-Cubby button
  on iOS is a Link(url), including on the small widget, which historically took one tap target (widgetURL, IOSV:87).
- Lock Screen buttons are inert until unlock, and lock-screen widgets ignore "show previews" (IOSV:138, :168). StandBy,
  the iPad lock screen and iPhone widgets on a Mac show home-screen widgets without an unlock.
- Refresh is rationed: roughly 40 to 70 iOS timeline reloads a day; Android's updatePeriodMillis floor is 30 min
  (WorkManager 15). A widget can never assume it is current, and never draws a relative time as a fixed string (6.9).
- Before first unlock after a reboot the iOS App Group container is unreadable (IOSV:128): a real empty state, never zeros.
- The native shells have no Firebase identity (capacitor.config.json:26-28, skipNativeAuth), so native code cannot touch
  Firestore. That is why Sleep in place needs a Worker token.
- Android has no Kotlin today (android/build.gradle:9-12), no Android SDK or JDK 21 on this Mac, and its shell cannot sign
  anyone in (no Firebase plugins, no google-services.json).

Product and repo
- Privacy on glass: text only, no photos or avatars in any shared container, ever (IOSV:240).
- Pro never gates the glance or any logging button; the snapshot carries no Pro field (PRO:358, :376-394, :502).
- Household doc is whole-field overwrite: read-merge-write, never blind-set (test/blob-clobber.test.js).
- The repo is public. Commit messages and tests describe behaviour, never an exploit, before a fix is live.
- A test not wired into tools/gates.js does not exist. Ubuntu CI cannot build or render either widget, so CI gates are
  string, JSON, browser (against the PWA) or emulator level; native gates run in the Mac build scripts (6.12).
- ios/ and android/ are gitignored (.gitignore:29-31) and regenerated by `npx cap add`. Native source lives in tracked
  directories, copied in by script, and fenced from deploy (.assetsignore, deploy_exclusion_check).

## 4. Approaches

- A. Every tap opens the app on the right sheet. Cheapest, no server work; weak at the moment that matters most (starting
  sleep one-handed in the dark), and thin under App Review guideline 4.2 (IOSV:96).
- B. A, plus Sleep in place through one Worker endpoint. CHOSEN (D6), built right after A. Sleep is the one log with no
  details to choose (start is "now", stop is "now"); feed, nappy and health need a choice, so opening the sheet is the
  calm answer. The write logic lives once, on the Worker, tested on the Firestore emulator; Swift and Kotlin only send
  `{t, babyIds, action, starts}`. In-place Sleep plus the live glance is the native substance that answers 4.2.
- C. Every button saves in place with "same as last time". Rejected (D6): a silent guess at 3am is a wrong log.
- Kotlin Multiplatform. Rejected (D1). Both shells remote-load one web app; the only per-platform code is widget UI
  (SwiftUI, Glance), which cannot be shared. Shared logic travels as generated data and golden fixtures from one source.
- Scrolling widgets, in-widget baby switch buttons. Rejected (D3). Twins use the picker, the twins layout, iOS stacks.

## 5. Where the grounding passes disagree (resolved here)

- cap_ios_configure.rb does not "abort" on a second target (IOSV:14): :288 finds only `App`, so a hand-added target is
  ignored and vanishes on the next `cap add`. IOSV's other line numbers predate e5db773a; 6.5, 6.12 and 7 cite current ones.
- scheduledPush is now store-firebase.js:3303 (pushNow :3313), not :2191. It returns while applyingRemote, so a snapshot
  hung off pushNow misses a partner's log; the export hangs off render() instead (6.6).
- Token shape. IOSV:176-178 favoured a stateless HMAC ticket. Revocation (sign-out, removal, household switch) needs state,
  so the token is both: an HMAC'd format refused with zero reads when forged, and a stateful record re-checked against
  membership on every use (6.8). The dose ticket (worker.js:2376-2432) is the precedent for both halves.
- Android toolkit. D1 rules out Kotlin Multiplatform, not Kotlin. The Android pass suggested pure-Java RemoteViews; this
  design uses Kotlin plus Glance (actionRunCallback for Sleep, layouts close to SwiftUI). UX pass (16 Nov): Android draws
  no live ago line (6.9), so AndroidRemoteViews is not needed for one. RemoteViews stays the fallback if the Kotlin plugin
  destabilises the shell build.
- Copy. SPEC wins over IOSV §5 (D2), then C1's clock-time headline. IOSV strings stay only where SPEC has none.
- SPEC:219, :322 ("iOS 16 opens; iOS 17+ logs in place") and SPEC:313 (three buttons) are superseded by D4 and D6. SPEC
  needs a revision note when this ships (builder task).
- UX pass (16 Nov): SPEC's in-widget button heights, 30px (SPEC:119, :224) and 34px on small (:342), are below the 44pt
  and 48dp minimums and are superseded by 6.1's layout floor. So is SPEC's 34pt "1h 05" small headline (:340): the
  small widget leads with the clock time (C1).

## 6. The design

### 6.1 Variants and sketches

Cubby's day and night tokens from app/index.html (SPEC:153, :321; the app wins, SPEC:450). Text only. Every status uses
Home's since-anchor (6.6). The number is the clock time in Home's format (fmtClock, index.html:2189; C1); the "ago" line
under it is drawn live on iOS and is absent on Android (6.9). Square brackets are buttons. ↗ is a drawn symbol, not
text, on every button that opens Cubby.

Post-birth medium (both platforms; design floor 321x148pt on iPhone, 276dp wide on an Android 4x2)
```
Robin · 2 months old                         Updated 3:14 AM
Last feed · Dad    Sleep              Last nappy
2:10 AM            Asleep now         1:40 AM
1 hr, 5 min ago    since 2:40 AM      1 hr, 35 min ago        (ago lines: iOS only; "· Dad": F7)
[Feed ↗]   [   Stop sleep   ]   [Nappy ↗]   [Activity ↗]
```
- Exactly three statuses (SPEC:312, :332). Empty reads "not yet". With no nap running, the label is "Last sleep" and the
  time is when she woke. UX pass (16 Nov): while a nap runs the label reads "Sleep", as on the 16 Nov board, so the cell
  never says "Last sleep" over "Asleep now".
- Builder call (16 Nov, sy25): Phase A binaries show "Sleep ↗" and open the sleep sheet. Phase B binaries show "Start
  sleep" or "Stop sleep" in place, and fall back to "Sleep ↗" whenever no usable token exists or a tap has just failed
  (6.7). The fourth button is the parent's pick, or Health while an illness is open (6.3).
- UX pass (16 Nov), overriding sy25's arrow-on-Sleep-only: the arrow marks every button that opens Cubby, as the 16 Nov
  board draws it, and the one button that works in place is solid with no arrow. With the arrow on Sleep alone, Feed and
  "Sleep ↗" both open Cubby yet look different, so neither mark means anything. In Phase A no button is solid. A long
  nap keeps the words "Stop sleep" but in the opens-Cubby style, soft fill and arrow (6.7).

Layout floor. UX pass (16 Nov), measured at the smallest sizes in Cubby's own fonts:
- Every button's hit frame is at least 44pt tall and wide on iOS, 48dp on Android. The board's 36pt buttons and SPEC's
  30 and 34px fail.
- iPhone medium (321x148pt): 16pt margins leave 116pt for header 22 + statuses 43 + buttons 44, which is 3.5pt per gap.
  Use 12 to 14pt margins (contentMarginsDisabled) or a 20pt header. Small: 12pt margins. Android 2x2 at 130dp: 12dp
  padding gives 50dp buttons (16dp gives 46). Choose Android layouts by height as well as width (SizeMode.Responsive): a
  4x2 in landscape is far shorter than in portrait.
- Button columns are unequal: Sleep 1.3fr, the other three 0.9fr, about 90pt and 63pt on iPhone, 76dp and 53dp on an
  Android 4x2. Every label then fits at 12pt ("Start sleep" is 63pt; at the board's equal columns it has 2.4pt spare on
  iPhone and overflows by about 10dp on Android), and the in-place button reads as the primary one.
- Type: the name 15pt display face, the number 15pt body weight 800, labels and ago lines 11pt, button labels 12pt (the
  board's 10pt is below DESIGN.md's ramp, whose floor is 11). iOS: lineLimit(1) and minimumScaleFactor(0.85) on every
  text; the widget's Dynamic Type is capped at xxLarge and tested there.
- "Asleep now" is 83.7pt at 15pt: it fits the iPhone cell (87.5pt) but not Android's (about 71dp) or large Dynamic Type.
  Where it does not fit, the number reads "Asleep" (49pt) over "since 2:40 AM", the same substance as C2. iOS chooses
  with ViewThatFits, Android by size bucket, both from one rule in widget-copy.json.
- Header truncation order: the freshness text never truncates; the age goes first, then the name tail-truncates. (An
  icon, "Alexandria Catherine", "2 months old" and "Updated 3:14 AM" measure 346pt against 289pt.)
- Colour. Opens-Cubby buttons wear their category's soft fill and ink; the in-place button is the solid sleep fill. By
  day the soft fills are only 1.11 to 1.13:1 against the widget ground and at night 1.00 to 1.11:1 (Activity is #2C281D
  on #2E2722), so at night every opens-Cubby button also gets a 1pt stroke in its category hue (feed 6.82:1, nappy
  6.54:1, note 6.30:1 against the night ground). DESIGN.md gains these pairs before the build.
- The solid button's text is `--on-sleep`: white by day, #1A1614 at night (6.44:1). White on the night sleep fill
  #8E97D4 is 2.79:1, a fail. In iOS accented and clear rendering the solid fill is .widgetAccentable(), so solid and soft
  still differ when the system drops the fills.
- The arrow is 11pt with stroke 2 (DESIGN.md §A6), at the button's top right; the board's 8pt arrow with a 2.6 stroke is
  too faint to carry the only "opens Cubby" cue.
- The fourth slot always wears the quiet (note) kind, whatever is picked: Health never looks like an alarm (SPEC:123;
  never terracotta or red), and Say it, whose QUICK_ACTIONS tone is --feed, never draws a second amber button by Feed.
- "not yet" is `--ink-soft` (5.46:1 day, 7.55:1 night), not SPEC's `--ink-dim` (1.95:1 day, 2.44:1 night,
  SPEC:293-295). The feed and nappy dots stay: they are decoration beside a text label.

Post-birth small (design floor 148x148pt on iPhone, 130dp on an Android 2x2)
```
Robin · last feed
2:10 AM
1 hr, 5 min ago · Dad    (ago on iOS only; the name only when someone else logged it, F7)
Updated 3:14 AM
[▶ Sleep]   [Feed ↗]     (the parent's two picks, F9; default Sleep, then Feed)
```
- F9: two buttons, the parent's picks. Sleep on the small widget reads "Sleep" with a play or stop glyph (the medium's
  "Start sleep" does not fit a 59pt button); its accessibility label says the whole action ("Start sleep for Robin").
  On Android, with no ago line, the logger's label sits alone on that line. A long label truncates before the clock.
- Link(url) buttons on iOS, Glance clickable actions on Android. If per-button Links fail on an iOS 17 device, small
  becomes one tap target that opens Home (drop the button row, no other copy change). On the small widget the
  illness switch follows F9: the second button becomes Health unless Health is already a pick.
- UX pass (16 Nov): the clock's digits are in the display face and AM or PM in 13pt body. "12:59 AM" all in Fraunces 34
  is 149pt against 116pt; "12:59" at 34pt plus " AM" at 13pt is 111pt. At the 148pt floor the digits drop to 28pt so
  the five rows and 44pt buttons fit the height; 30sp on an Android 2x2 is 101dp against 106dp. A long name truncates
  the name, never "· last feed". Labels stay on every button: at 3am they carry the meaning (no icon-only grid).

Lock screen (iOS only, accessoryRectangular and accessoryInline; post-birth only)
```
Last feed 2:10 AM
1 hr, 5 min ago
Robin · asleep since 2:40 AM          (or "Robin · woke 1:20 AM")
```
- Times only, no buttons, no ring or gauge (IOSV:235; SPEC:351's ring is dropped). Inline: "Last feed 2:10 AM". With
  "Hide details on the lock screen" on (`lockScreen.hide`, 6.6): "Cubby" alone. Never pregnancy (SPEC:362, :435).
- UX pass (16 Nov): colours are the system's vibrant primary and secondary, never hex, since iOS draws the lock screen.
  No question mark ever appears here, so a long nap shows only "Robin · asleep since 7:10 PM". "woke" is kept over "last
  sleep": the line has room for one fact, and "woke" cannot be read as how long she slept.

Pregnancy (home screen, both platforms; the opted-in owner's phone only; held until CA3 and F2's path exist, F4)
```
Quiet (default)              Opted in
Cubby                        Week 30
[Open ↗]                     Third trimester
                             Next visit Tue 14 Oct, 3:15 PM
                             [Kicks ↗]  [Symptom ↗]
```
- Quiet until the owner turns on "Show my week on the home screen" (D2): a per-person disclosure, not a preference
  (IOSV:155). A caregiver's snapshot has no pregnancy block; after a loss here, the wordmark, wiped synchronously
  (IOSV:154); a loss recorded on another device clears it through F2's pull and push, one reason it waits (F4).
- Kicks from 28 weeks, Contractions from 36 (index.html:4612-4613), Symptom always; they open the app, never write
  (IOSV:237). Mood never appears. Next visit shows a date and time only for a real appointment; an estimate reads "Next
  visit around week 32" (IOSV:306).
- Builder call (16 Nov, ss12): only for stage pregnancy with no bornBabyId; never in planning or trying (TTC refuses to
  predict). pregWeek() has no stage check, so the export uses quickPregWeek's rule (index.html:4665-4675).
- Builder call (16 Nov, ss11, sy15): this kind sets .disfavoredLocations for StandBy, the iPad lock screen, the Mac
  desktop and CarPlay. That modifier is fixed at build time, so with hide-details on, every kind reads its location at
  render (widgetLocation; prove on a device) and shows the wordmark there. Android providers declare home_screen only.
- Builder call (16 Nov, sy14): iOS lists every compiled kind in every gallery, so this kind ships with a neutral gallery
  description and a wordmark-only preview in every state. Android disables its provider (setComponentEnabledSetting)
  whenever the pregnancy block would be empty. While F4 holds the widget back, the kind is not compiled at all.

Twins layout (medium configured as Both; offered to any two-baby family, D3)
```
                                                Updated 3:14 AM
Robin        Last feed 2:10 AM       1 hr, 5 min ago     (ago: iOS only, dropped first)
Wren         Asleep since 2:40 AM
[Feed ↗]   [   Stop sleep   ]   [Nappy ↗]   [Activity ↗]
```
- Builder call (16 Nov, br7): each baby's one status is last feed, as on the 6 Oct twins Medium board, replaced by
  "Asleep since 2:40 AM" while that baby's nap runs. Defaults for twins, siblings and three babies: 6.4.
- UX pass (16 Nov): rows, as the 16 Nov board draws them, not columns. The header carries only the icon and "Updated
  3:14 AM" ("Robin and Wren" with long names measured 349pt against 289pt). Each row carries its baby's name in a
  flexible column up to about 90pt, tail-truncated (the board's fixed 56pt column cut anything over about 7 letters).
  "Last feed 2:10 AM" is 108pt and "Asleep since 2:40 AM" 125pt, so both fit beside a 90pt name; the live ago line ends
  a feed row on iOS where it fits and is the first thing dropped.
- UX pass (16 Nov): after "Start both" both rows read "Asleep since", so a wrong start shows at once. For twins the
  Sleep button reads "Start both" when no nap runs, "Stop sleep" when one runs (it stops that one; the asleep row shows
  which), and "Stop both" when both run. For siblings set to Both it is "Sleep ↗" (6.4).
- Builder call (16 Nov, sy24): on iOS a stack of one widget per baby gives swiping (D3), and the stack helper copy
  recommends turning Smart Rotate off. Android breakpoints: 4x2 cells and up use the medium (or twins) layout, 2x2 the
  small layout, smaller the wordmark; small is its own provider so the two galleries match.

### 6.2 Edit Widget configuration

Two fields and nothing else (D7).
- Baby: each baby's name, plus "Both" in a two-baby family. Default at add time: Both for twins, else the active baby.
- Your button: Activity, Health, Pump, and on Android Say it. Default: Activity.
- Small widget only (F9): "First button" and "Second button" instead of "Your button", each from Feed, Sleep, Nappy,
  Activity, Health, Pump (Say it on Android). Default: Sleep, then Feed. Picking the same action twice is not offered.
iOS: AppIntentConfiguration with an AppEntity for babies, read from the snapshot. Android: a Glance configuration
activity, two plain lists, no webview. A configured baby gone from the snapshot reads "Open Cubby to pick a baby."

UX pass (16 Nov): the iOS Edit Widget sheet is drawn by the system. Row titles come from `@Parameter(title:)`, so they
are "Baby" and "Your button" (the board's wording; "Fourth button" counts slots), and the only free text is the
configuration intent's IntentDescription: "Feed, Sleep and Nappy are always on your widget. While your baby is unwell,
your button shows Health, then goes back." ("your baby", not "someone", which could mean the parent.) There is no
Cubby-branded header to design. Android shows the same two rows (each at least 48dp) and the same sentence, and the
provider declares `widgetFeatures="reconfigurable|configuration_optional"`, so adding a widget never forces the setup
screen: the defaults above apply until the parent changes them.

Builder call (16 Nov, br5), flagged for the founder because it narrows what he approved: Say it opens voice logging,
which is Pro with free tastes (voice-log.js:208-209 calls useTaste then openPro), and a widget leading into a Pro gate is
the 3.1.1 hazard on iOS. So Say it is off the iOS list until voice logging is free or in-app purchase exists. Android may
offer it as a declared platform difference (6.11); the Pro anti-goal holds there too, so it ships on Android only once
the deep-link gate shows a widget-opened voice log never reaches the Pro sheet.

### 6.3 Buttons, and the illness switch

Fixed: Feed, Sleep, Nappy (D4). While the configured baby (for Both, either baby) has an open illness (a state.illnesses
entry with no endedAt), the fourth slot becomes Health, and returns to the pick when it ends. The snapshot carries only a
boolean per baby, `healthOpen`. The switch is automatic (F5). Health also returns to the pick after 14
days with no illness entry for that baby (an episode nobody marked better, index.html:15272): the export sets
`healthOpen` false once that baby's newest illness entry, of any kind, is more than 14 days old. The rule is data with
golden fixtures (6.11).

Health always opens Cubby, per baby (D5): straight to the ill baby's illness sheet; both ill, or a Health pick with no
illness open, opens "Who is this for?". Temperature, Symptom and Medicine are logged in Cubby, never in place (C7).

UX pass (16 Nov): the switch is never silent. A parent who picked Pump loses it while her baby is ill, so it is said in
words in two places: the Edit Widget description (6.2), and one line added to the app's own confirmation when an illness
is opened on a phone where `hasWidgets()` is true and the switch changes the button: "Your widget now shows Health until
Robin is better." Nothing about the illness reaches glass. Health wears the quiet kind like any fourth button (6.1).

### 6.4 Twins, siblings, and Both

Builder call (16 Nov, sy21). The app treats any two babies as twins (targetChips, targetSetAll, index.html:2322-2326,
2457-2466); the widget does not.
- Twins (exactly two babies sharing a birth date; snapshot `twins:true`): a new widget defaults to Both, and every button
  to Both (D5). Feed, Nappy, Pump and Activity open with targetSetAll() applied, so "Log for: Robin / Wren / Both" shows
  Both and the parent can narrow it. Sleep in place: if no nap runs, Start starts both; if any runs, Stop stops every
  running one, each carrying the start the widget showed, in one atomic commit (6.7). Labels: "Start both", "Stop
  sleep" with one running, "Stop both" with both (6.1). UX pass (16 Nov): "sharing a birth date" means birth dates at
  most one day apart, since twins can be born either side of midnight.
- Siblings (different birth dates): a new widget defaults to the active baby, its buttons to that baby, and the chips
  still offer Both. A siblings widget set to Both shows the twins layout, but every button, Sleep included, opens its
  sheet on the active baby: one tap never starts sleep for two children of different ages.
- Three or more babies: the app says "All"; the widget offers each baby on its own, and no twins layout.

### 6.5 Deep-link targets

All taps open `https://little-cubby.com/app/?go=<target>&baby=<id|both>&from=widget`. The router is stashDeepLink /
runDeepLink (index.html:2713-2834); native delivery is appUrlOpen and getLaunchUrl into routeDeepLink
(native-bridge.js:15-40, 160-181).

| Button | ?go= | Exists today |
|---|---|---|
| Feed / Nappy | feed (openFeed) / diaper (openDiaper) | yes, BABY_GO :2798 |
| Sleep ↗ (Phase A, no token, or just after a failed tap) | sleep (openSleep) | yes |
| Stop sleep ↗ (a long nap, 6.7) | sleepfix (openSleepCorrect for the running nap) | no, add |
| Pump / Activity | pump (openPump) / activity (openActivity) | no, add to BABY_GO |
| Measure / Milestone (long-press only, 6.10) | measure (openGrowth) / milestone (openCustomMilestone) | no, add to BABY_GO |
| Health | health (the open illness's sheet, else the baby's health view) | no, add |
| Say it (Android only) | voice (openVoiceLog) | no, add |
| Kicks / Contractions / Symptom | kicks / contractions / symptom | yes, PREG_GO :2794 |
| Widget body | none (Home); the sleep sheet while a failure line shows | yes |

UX pass (16 Nov): measure and milestone are added because the long-press menu's fourth item is the parent's first chosen
quick action, which for a default parent is Measure (QUICK_DEFAULTS, index.html:4639), and BABY_GO has no `measure`
(:2798), so that shortcut would land on Home.

Router work. Builder call (16 Nov, sy4, sy5, sy6, sy22):
- routeDeepLink builds its link from a whitelist (go, stage, read, tab; native-bridge.js:33, :171). Add `baby` and
  `from`, or every native tap drops the baby.
- Android: the widget's Intent is ACTION_VIEW with the https URL as data, explicit to MainActivity (FLAG_IMMUTABLE).
  Capacitor ignores extras (AppPlugin.java:145-150), so Glance ActionParameters never carry the target.
- iOS: Link(url), https on the applinks entitlement or a `cubby://` scheme at configure.rb:183-187 (prove one on a device),
  so the URL reaches SceneDelegate. The launch URL is cleared after routing (Capacitor keeps iOS lastURL and Android
  intentUri), so a later webview reload never replays a widget tap.
- `baby=` applies AFTER openX(), because every open calls initTargets(), which resets logTargets. Set activeBabyId, then
  targetSetOne(id) or targetSetAll(). An unknown id falls back to the active baby silently.
- Keep the loss-holding swallow (:2754) and hasBaby gating; pregnancy targets get mood's owner check (:2802).
- Builder call (16 Nov, ss13): `from=widget` records one first-party event (D8), `widget.opened`, carrying only
  `{from:'widget'}` plus, for baby log targets, a coarse target class. Never a health, pregnancy or medicine target;
  nothing during her own loss holding. It needs a .telemetry/tracking-plan.yaml entry.
- Known cost: a cold tap waits for auth, about 1.5MB of index.html and the 800ms splash (IOSV:408). If the webview is
  signed out, the tap lands on sign-in and the deep link runs after.

### 6.6 The snapshot contract

Two keys in the shared container, one per writer, each with its own timestamp. Typed fields only; no free text from the
web except a baby's display name (PRO Review B #7, :716-720), so a web deploy cannot put "Try Pro" on glass.

```
appSnapshot (written only by the app)
{ "v": <highest version the installed binary reads>, "state": "ok"|"quiet"|"signedOut",
  "at": <ms, when the app last saw this from a live listener>, "twins": <bool>, "lockScreen": { "hide": <bool> },
  "babies": [ { "id", "name": <max 20 chars>, "age": { "unit": "day"|"week"|"month"|"year", "n" },
                "last": { "feed": <ms|null>, "sleep": <ms|null>, "nappy": <ms|null> },
                "nap": { "start": <ms>, "ack": <ms|null> } | null, "healthOpen": <bool> } ],
  "activeBabyId", "shortcuts": ["feed","sleep","diaper"],
  "pregnancy": null | { "week": <1-42>, "tri": 1|2|3, "nextVisit": { "at": <ms|null>, "week": <int|null> } | null,
                        "kicks": <bool>, "contractions": <bool> } }
napState (written only by the widget, from a nap-route reply or a failed tap)
{ "babies": { "<babyId>": { "nap": { "start", "ack" } | null, "at": <ms, server time of the reply> } },
  "line": { "key": "noConnection"|"notSaved"|"alreadyStarted"|"alreadyStopped", "until": <ms> } | null }
```
- UX pass (16 Nov): `line` carries the one-line message a tap leaves behind (6.7), as a key whose words live in
  widget-copy.json, until `until` or the next snapshot or nap reply. Babies sit under `babies` so no baby id can collide
  with `line`.
- Builder call (16 Nov, sy8, se4): at render, each baby's nap comes from whichever of appSnapshot.at and napState.at is
  newer. A nap reply carries timer state only, so it never freshens feed or nappy: "Updated" shows when the oldest field
  on screen was last current (6.9), and each anchor keeps its own age.
- `last.*` are since-anchors with Home's rule (sinceAnchor, index.html:5151): sleep ev.end, feed with dur>0
  ev.time+dur, otherwise ev.time. Builder call (16 Nov, ss14): per baby, with babyEvents()'s filter (drops e.deleted,
  :2099) and sinceCard's rule (a sleep counts once it has an end, :4087-4089).
- F7: each baby also carries `"by": { "feed": <label|null>, "sleep": <label|null>, "nappy": <label|null> }`, the circle
  label (loggerName, index.html:3441: relationship label, else first name; never an email; at most 12 characters) of
  whoever logged that anchor, and null when it was this phone's own user or the entry has no author. Computed per phone
  at export (and per requesting member by F2's pull), so the same entry reads "· Dad" on Mum's widget and nothing on
  Dad's. A member who has left is still named from formerMemberInfo: their logs stay (circle roles). `by` is stamped at
  write: addEvent, the targets path for Both, stopSleep, saveSleepCorrect, and the Worker's sleep route; the app never
  back-fills older entries.
- `nap.ack` is the app's "still asleep" snooze (t.ack, keepSleepRunning :6293); the widget honours it (6.7).
- Builder call (16 Nov, ss10, sy13): "Hide details on the lock screen" and "Show my week" are per person (localStorage
  by uid, mirrored to users/{uid}), never state.settings. `lockScreen.hide` carries the first to glass.
- `pregnancy` only when the viewer is the owner (quickOwnerOnlyOk(), :4659), has opted in, the stage is pregnancy with no
  bornBabyId, and the signed-in user and journey have loaded. The owner checks answer true with no user
  (index.html:13411, :13416; store-firebase.js:3547, :3597), so the export never runs during the boot paint.
- `state:"quiet"` during loss holding (myLossHolding(), :9253) with no living child: wordmark only. With a living child (F3): the
  post-birth widgets keep that child's times and Sleep button, as Home does; no pregnancy block, no pregnancy shortcuts,
  neutral gallery.
  `state:"signedOut"` on sign-out, account switch and account deletion. Malformed JSON or an unreadable container:
  "Cubby" alone (IOSV:126). No Pro field, photo, illness detail, mood, notes or medicine, ever.
- Builder call (16 Nov, sy12): the plugin reports the snapshot versions and shortcut keys its binary reads; the web writes
  the highest version that binary understands. Router targets are never removed while any shipped table emits them.

Who writes it, and when
- One `exportWidgetSnapshot()` at the end of render() (index.html:2693), debounced, written when its stable JSON changes.
  render() runs after local writes and every remote snapshot (store-firebase.js:51), so a partner's log reaches the widget
  whenever this app is open. Also from the persist override (store-firebase.js:3536).
- Builder call (16 Nov, se8, ss9, ss3): wipes are synchronous, before the action continues: endPregnancy, entering loss
  holding (also on the receiving device), signOut, doDeleteAccount, household switch, access lost (showAccessLost,
  store-firebase.js:2672-2700), and any 401 a re-mint cannot fix. Each clears appSnapshot, napState, the token,
  UIApplication.shortcutItems and the Android dynamic shortcuts.
- Builder call (16 Nov, se12, sy16): none of it is backed up (App Group container excluded; Android dataExtractionRules
  and fullBackupContent exclude the widget prefs and token). Undecryptable after a restore means signed out.
- Transport: a Capacitor plugin `CubbyWidget` (`setSnapshot({v, json})`, `clear()`, `hasWidgets()`, `versions()`, the 6.8
  token calls) via native-bridge.js, guarded like boot() (:99-107). iOS: UserDefaults(suiteName:
  group.com.littlecubby.app), then reloadAllTimelines(). Android: SharedPreferences, then GlanceAppWidget.updateAll.

### 6.7 Sleep in place, end to end (Phase B)

Where a running nap lives. Builder call (16 Nov, se2, se3, se11, sy8), carrying out C4: running naps move out of the
household blob into their own per-baby document (`households/{hid}/timers/{bid}` or `timers/{hid}_{bid}`), field
`sleep:{start, ack, by}`. The app (startSleep, startSleepFrom, stopSleep, saveSleepCorrect, keepSleepRunning) and the
Worker write it only by read-merge-write transaction under an updateTime precondition (the Worker's in a documents:commit
body). The sleep event id is `sleep-<bid>-<start>` for app stops and corrections too (today uid(), index.html:6240,
:6287), so an app stop and a widget stop of one nap are one document. Feed timers stay put. This replaces the earlier
per-path app.timers fix, which still let a stale phone resurrect or erase a nap (store-firebase.js:1579-1586, 1626-1641).

A tap on Start sleep or Stop sleep:
1. NapIntent (an AppIntent in the extension) or the Android ActionCallback reads the token and the configured baby or
   Both. Builder call (16 Nov, se18): NapIntent is isDiscoverable=false and its authenticationPolicy requires an unlocked
   device, so Shortcuts, Siri and the Action button cannot run it on a locked phone.
2. While the request runs, the button dims and keeps its label (iOS invalidatableContent; Android a Glance state). UX
   pass (16 Nov): no "Saving" text on either platform. WidgetKit redraws only after perform() returns, so iOS cannot
   show it, and Android showing it alone would be a platform difference for nothing. invalidatableContent also covers
   the sleep status.
3. POST `/api/widget/nap {t, babyIds, action, starts}`. Builder call (16 Nov, se1): Stop and Undo carry, per baby, the
   start the widget displayed. The household comes only from the token record; any hid in the body is ignored.
4. ok: the widget writes the reply's timer state into napState and redraws. Builder call (16 Nov, se20): for 10 seconds
   the button reads "Undo" (an AppIntent or Glance callback), which reverts through the same endpoint. UX pass (16 Nov):
   an `already:true` reply also leaves one line in the freshness slot, "Already started in Cubby." or "Already stopped in
   Cubby." (about 170pt), so the parent knows her tap made no second nap. "in Cubby", not "on another phone": the other
   writer may be this phone's app or the web.
5. 409: the nap moved on (stopped elsewhere, or another runs now). The reply carries the current timer state and the
   widget redraws from it, with the same "Already" line where it applies. It never stops a nap it did not show.
6. Definite failure (no connection when sending; 401 or 503, which mean nothing was written; 403 is below). Builder call
   (16 Nov, br6, ss15), worded by the UX pass (16 Nov) to follow C3, which says an offline tap says so: with no
   connection the freshness slot reads "No connection, so that didn't save." (168pt, fits); on 401 or 503 it reads "That
   didn't save. Open Cubby to log it." For that timeline period the Sleep button turns "Sleep ↗" in the opens-Cubby
   style and, like the widget body, opens the sleep sheet; the button beside the line is the next step. Never "Tap to
   try again": at 3am that invites a loop of taps that cannot work. Nothing is queued (C3).
7. Unknown outcome (sent, no answer: a timeout, a killed intent). Builder call (16 Nov, se5, sy7): never say it did not
   save, since the commit may have landed. On the next render the widget asks for the timer state (`action:"state"`) and
   shows "Checking" (with invalidatableContent on iOS) until it answers. perform() has a 10-second budget.

When the Sleep button opens Cubby instead
- Builder call (16 Nov, se17, sy9): with no usable token (none minted yet, refused, a local-only user with no household,
  an unreadable Keychain), it is "Sleep ↗" and opens the sleep sheet; never a live Start that can only fail.
- Builder call (16 Nov, se16, ss8): a nap running 12 to 24 hours without the app's snooze, or over 24 hours at all,
  writes nothing long in place and opens the correction sheet. The glass asks gently, never commands.
- UX pass (16 Nov), replacing that call's wording: the status stays "Asleep now" / "since 7:10 PM", as Home shows it
  (index.html:4236); the header's age gives way to "Did it end earlier?" (87pt at 11pt, beside "Updated", which stays);
  and the button keeps the words "Stop sleep" in the opens-Cubby style, soft fill and arrow, opening `sleepfix`, where
  the app's own banner asks the rest ("Tap to say when they woke", index.html:5014-5015). "Set when they woke" is 116pt
  at 12pt against a 90pt Sleep column and "Sleep started" 96pt against an 87.5pt cell, so neither fits; "Stop sleep ↗"
  still says what a tap does.
- UX pass (16 Nov): the review asked that every nap over 12 hours open Cubby. The snooze exception stays: `ack` exists
  only when the parent told the app "still asleep", and counts with Home's own test, less than 6 hours old (the banner's
  condition, index.html:5008), so a stop in place then is what she said, not a guess. Below 24 hours the app's own
  stopSleep writes the nap (index.html:6239), so the widget is already the stricter of the two. The Worker and the
  golden fixtures use the same 6-hour test.

Server (worker.js, one route family)
- Builder call (16 Nov, se6): a per-IP limiter (WIDGET_RATE_LIMITER) runs before anything costs a read, as the dose route
  does (worker.js:3329-3333). The token is HMAC'd like the dose ticket (:2413-2425), so a forged one costs zero reads.
  Then a per-token limit, then `widgetTokens/{sha256(t)}`: missing or expired answers one uniform 401.
- fsGetStrict the household with mask `members, deleteAfter, app.babies`; a failed read answers 503, never "no". Require
  member (_isCarer, worker.js:1498-1503) and no deleteAfter. Not a member: delete that token row and answer 401.
- Builder call (16 Nov, se14): a babyId not in the token's household answers 403 `{reason:'baby'}`, which the widget does
  not retry; it reads "Open Cubby to pick a baby." and its next tap opens the app.
- Builder call (16 Nov, se10): server time rules. The Worker writes start and end from its own clock. A stored start must
  be a finite integer no more than 5 minutes in the future, and end must exceed start; otherwise `{needsApp:true}` and no
  write. The app writes start from server-aligned time where it has it.
- Start: if `sleep` exists, answer `{ok, already:true, sleep}` (a partner started it; the widget shows Stop); else write.
- Stop: the sent start must equal the stored one, else 409 with the current state. One commit, two Writes: clear `sleep`
  under the updateTime precondition, and create `events/sleep-<bid>-<start>` under `exists:false` with `{id, authorId:uid,
  babyId, type:"sleep", time:start, end:now, via:"widget"}`. ALREADY_EXISTS on the event means it is already logged:
  `{ok, already:true}` with the current state, never a race. Past 12 hours without the snooze (an ack under 6 hours old), or past 24 hours,
  Stop answers `{needsApp:true}` and writes nothing, so a stale button cannot write a long nap.
- Undo reverts only what the tap made, and only if it still holds: an undone Start clears that start; an undone Stop
  restores the timer and marks the event `deleted:true` (the soft delete babyEvents() drops), in one commit. Else 409.
  `action:"state"` returns the requested babies' timer state and writes nothing.
- Builder call (16 Nov, se15): every Write is an `update` with an updateMask. Clearing names `sleep` in the mask and
  leaves it out of the fields. The sign-in loop's `{delete: name}` Write (worker.js:1046) is never copied here; aimed at
  the household it would erase the family's document under the service account.
- Builder call (16 Nov, se5, sy7): a raced precondition is re-read and retried once, then 503, inside the 10-second
  budget; only precondition failures count as raced. With Both, every baby's Writes go in one commit, and any mismatch
  refuses the whole commit with 409 and the current state.

### 6.8 Widget sign-in token

- Mint: POST `/api/widget/mint {idToken, hid, deviceId}`. Builder call (16 Nov, br3, se7): any valid Firebase ID token
  (worker.js:2439-2459), no auth_time window (auth_time survives refresh, so a window refuses every existing user), plus
  a server-side check: Identity Toolkit accounts:lookup refuses a disabled account or a token issued before validSince,
  and households/{hid}.members is re-read (never users/{uid}.householdId). Proven on the Auth emulator with tokens the
  emulator issued, never hand-made ones like test/feedback-purge-emulator.test.js:42-61.
- Builder call (16 Nov, se9): mint is one transaction. It stores `widgetTokens/{sha256}` = `{uid, hid, deviceId,
  createdAt, expireAt (90 days, sliding on use), lastUsedAt}`, replaces any token for the same (uid, deviceId), and at 5
  per uid evicts the least recently used. deviceId is generated natively (iOS Keychain, ThisDeviceOnly; Android a
  no-backup file), never in webview storage, so a storage reset cannot multiply tokens.
- When. Builder call (16 Nov, se17, sy9): on every app foreground while hasWidgets() is true; it replaces this device's
  row, so nothing accumulates. Until a token exists the widget shows "Sleep ↗".
- Storage. Builder call (16 Nov, se12, sy16): iOS Keychain, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, in the
  shared access group (6.12); the app purges Cubby's Keychain items on the first launch after a reinstall. Android:
  encrypted with a Keystore key, excluded from backup; undecryptable means signed out.
- Rules: `match /widgetTokens/{id} { allow read, write: if false; }` beside signinCodes and pushLedger
  (firestore.rules:162-165). Builder call (16 Nov, se19): a Firestore TTL policy on expireAt, deployed via firebase.json.
- Revoke. Sign-out calls `/api/widget/revoke` (the token is its own credential), then clears the stored item. Builder
  call (16 Nov, se14): a household switch revokes and re-mints. Builder call (16 Nov, se8): removal deletes that member's
  tokens server side. Builder call (16 Nov, se19): purgeAccountData (worker.js:2167-2188) and the household purge (:1962)
  delete matching tokens, and the app retries a failed purge instead of swallowing it (store-firebase.js:3841-3851).
- Scope: the nap route (start, stop, undo, state), and the snapshot pull (F2). No other route accepts it.

### 6.9 Freshness

- Builder call (16 Nov, ss6): the number is the clock time ("2:10 AM", C1). Every relative time keeps "ago" (fmtSince,
  index.html:2209-2218: without it "Last sleep 2h 15m" reads as how long she slept). A running nap never counts up:
  "Asleep now", "since 2:40 AM" (C2).
- Builder call (16 Nov, ss7, sy2): no relative time is drawn as a fixed string. iOS uses Text(date, style: .relative)
  followed by "ago", and the clock time carries the fact. The live wording is the system's ("1 hr, 5 min ago", never
  fmtSince's "1h 5m ago"), so the golden fixtures (6.11) assert clock times and states, not the ago text.
- UX pass (16 Nov): Android draws no ago line. It refreshes at most every 30 minutes, so any ago it drew could be 29
  minutes wrong (a stale number that looks live), and Chronometer counts seconds, the ticking counter C2 rules out. The
  ago line is a declared platform difference, by key, in widget-copy.json; the parity gate allows only that key.
- UX pass (16 Nov): the ago line never shows seconds. Prove .relative on an iOS 17 device; if it ticks seconds under
  the hour, use a minute-only live style where the OS offers one and otherwise leave the line off, as on Android (C1's
  headline, the clock time, is unaffected).
- UX pass (16 Nov), replacing "updated 4m ago": the freshness line is a clock time, "Updated 3:14 AM", the moment the
  oldest field on screen was last current (6.6). A clock time cannot go stale in its wording, so it needs no live
  drawing. Over 6 hours, statuses are hidden and the widget reads "Open Cubby to catch up." iOS adds a timeline entry at
  that boundary; past the last entry the stale rule holds.
- UX pass (16 Nov): an anchor more than 20 hours old shows its day in place of the ago line, on both platforms:
  "Yesterday", the weekday within a week ("Mon"), else the date ("14 Oct"). Within 20 hours a past clock time cannot be
  mistaken for a later one today, and Android has no ago line to correct it. "Updated" takes the same rule ("Updated
  yesterday 11:50 PM", 145pt, fits). The rule is data with golden fixtures (6.11).
- UX pass (16 Nov): every time on glass uses fmtClock's form ("3:15 PM"), including the pregnancy visit. fmtClock is
  12-hour for everyone today, so the widget is too; the review's 24-hour variant would make the widget disagree with
  Home, and arrives the day fmtClock gains one, through the shared rules.
- Partner freshness (F2). The widget's timeline refresh calls `GET /api/widget/snapshot` with its token; the Worker
  computes the contract from a since-rule module shared with the app (6.6's filters; the widget_since_parity gate). After
  any log, from the app or the nap route, the Worker sends the household's other members a silent push (APNs background
  push with the Apple push key, C5; an FCM data message on Android) and their widgets reload now. The pull answers the
  same snapshot the app would export, so the two writers stay one contract, merged at render by newest (6.6). iOS budgets
  background pushes and reloads, so the "Updated" line still states its age; nothing claims to be live. The token's
  scope widens to this one read (6.8). Proven on the emulator with the real Worker and two members.

### 6.10 Long-press app shortcuts

Builder call (16 Nov, ss3, sy3): no static shortcuts on either platform. Static items cannot be removed at runtime and
would show Feed, Sleep, Nappy to a pregnant or a bereaved parent. All are dynamic, set by the app from the snapshot's
`shortcuts`, at most four, labelled from QUICK_ACTIONS.
- Baby stage: Feed, Sleep, Nappy, plus the first chosen quick action. Child stage: QUICK_DEFAULTS child order.
- UX pass (16 Nov): "first chosen quick action" means the first that has a router target and is not gated. Say it
  follows br5 here too: never on iOS, and on Android only once the deep-link gate shows a shortcut-opened voice log never
  reaches the Pro sheet. Measure and Milestone get routes (6.5).
- Pregnancy owner: Kicks (28w+), Contractions (36w+), Symptom, only with the pregnancy widget's opt-in. Caregiver in
  pregnancy: none. Loss holding with no living child: none (with one, the living child's baby shortcuts stay, F3).
- UX pass (16 Nov): a long-press is a glance anyone holding her phone can take, so the one switch, "Show my week on the
  home screen", covers both, and its helper says so (section 8). F4 holds the pregnancy widget, so the switch and these
  shortcuts wait with it; until then pregnancy shows no shortcuts.
- iOS: UIApplication.shortcutItems set by the plugin; SceneDelegate (configure.rb :88-115) turns an item into the same
  ?go= URL. Android: ShortcutManagerCompat with ACTION_VIEW intents as in 6.5. Every wipe clears both. Nothing shows
  until the app has run once.
- UX pass (16 Nov): the gate holds the no-static rule. widget_parity_check fails if native-ios/ or the configure scripts
  declare UIApplicationShortcutItems, or native-android/ holds a shortcuts.xml or android.app.shortcuts meta-data; the
  Mac build checks the built Info.plist and merged manifest the same way (6.12).
- PWA manifest shortcuts (:37-56) stay; tools/shortcuts_check.js keeps them baby-only and equal to QUICK_ACTIONS labels.
  UX pass (16 Nov), follow-up outside this design: those are static too, so a pregnant or bereaved parent with the PWA
  installed sees Feed, Sleep, Nappy on long-press today. Not changed here: removing a live feature needs the founder's
  OK.

### 6.11 One source, a generator, and a parity gate

- Source: QUICK_ACTIONS (index.html:4596-4635) gains a `widget` field where relevant: `widget:{go:'sleep',
  inPlace:true}`, `{go:'diaper'}`, `{go:'health', perBaby:true}` (Health is a new widget and shortcut entry),
  `{go:'voice', platforms:['android']}` (br5). Labels come from each entry's `label`. Begin and end comments mark the array.
  UX pass (16 Nov): `measure` and `milestone` gain `{go}` entries for the long-press menu (6.10), and the widget's fourth
  slot takes its tone from the quiet kind, not the entry's `tone` (6.1).
- docs/widgets/widget-copy.json: every glass string (section 8), the in-place labels, format rules, the snapshot schema
  and its versions, and declared platform differences. Builder call (16 Nov, sy10): the rules both platforms implement
  (6h stale, 12h and 24h nap, illness switch, twins and siblings, missing baby, fmtSince bands) are data here too, with
  golden fixtures (snapshot + now -> expected strings) generated by JS. Swift XCTest and Kotlin unit tests read them in
  the Mac build scripts; each is seen red once. UX pass (16 Nov): also data, with fixtures: the 6-hour snooze test, the
  20-hour day rule, "Asleep now" or "Asleep" by width, the long-nap header line, the `line` keys and their lifetime,
  the twins Sleep labels, and the VoiceOver and TalkBack labels (section 8). The declared copy differences so far are
  the ago line, Say it (br5) and the lock screen; any other fails the gate.
- tools/widget_gen.js writes `native-ios/CubbyWidget/Generated.swift`, `native-android/.../Generated.kt` and, Builder
  call (16 Nov, sy23), `res/values/widget_strings.xml`, never Capacitor's strings.xml (the manifest needs its app_name and
  title_activity_main). Hand-written Swift and Kotlin hold no user-facing literals.
- tools/widget_parity_check.js (gate): regenerates in memory and fails on any diff with the committed files, or any
  undeclared platform difference. Builder call (16 Nov, sy11): the literal ban matches SwiftUI Text, Button and Label,
  .configurationDisplayName, .description, AppIntent title, @Parameter(title:), AppEntity display representations,
  Glance Text (positional and named), and android:label / android:description in provider XML. Copy rules: no em-dash,
  no "Pro", no streak or total words, and Builder call (16 Nov, ss16) no Title Case word after the first, with a short
  proper-noun list (Cubby, Smart Rotate, AM, PM). `--self-test` changes one label per platform and plants an em-dash, a
  Title Case string and one literal per matcher in fixture files; each must go red.
- UX pass (16 Nov), more copy rules: banned phrases "don't forget", "last chance", "time for", "streak" and "goal" (the
  guilt and streak patterns of Duolingo, Deepstash and Flo's lock-screen nudge), and no question mark in any lock-screen
  string. The proper-noun list also takes the button labels read from QUICK_ACTIONS (Feed, Sleep, Nappy, Health and the
  rest), so the Edit Widget sentence can name them. The self-test plants one banned phrase and one lock-screen question.
- UX pass (16 Nov): any AppIntent or Glance ActionCallback in native source that is not generated from an `inPlace:true`
  entry fails the gate, so nothing but Sleep can ever write from glass (D6). The self-test plants one.
- UX pass (16 Nov): the no-static-shortcuts check of 6.10 lives here too.
- Native source lives in tracked `native-ios/` and `native-android/`, copied in by configure scripts; add both to
  .assetsignore, INTERNAL[] (tools/deploy_exclusion_check.js:33-48) and, one file each, MUST_404[] (:51-56).

### 6.12 Gates and tests (each seen red before trusted)

| Gate | Tier | Proves | Red run |
|---|---|---|---|
| widget_parity_check | default | 6.11 | --self-test plants |
| widget-snapshot.test.js | default (puppeteer, local serve) | no pregnancy for a caregiver, the trying stage, bornBabyId or the boot paint; quiet on loss; illness gives only healthOpen; no Pro field; anchors equal Home's with deleted events and open sleeps present; hide flag per person; every wipe trigger clears snapshot, napState and shortcuts | export leaks an illness name; pregnancy to a caregiver; a deleted feed counts |
| widget-deeplink.test.js | default | drives the native path (appUrlOpen into routeDeepLink), not location.search, for every target any shipped table emits, widget buttons and long-press shortcuts alike (UX pass); baby and Both survive initTargets; the launch URL routes once; no destination opens Pro or shows a Pro mark; measure and milestone land on their sheets, not Home | drop `baby` from the whitelist; remove the post-open targetSetAll; route voice through the paywall; drop `measure` from BABY_GO |
| dose push copy (C6, UX pass) | default | a dose reminder's lock-screen title and body name no medicine, for every reminder kind the Worker sends | put the medicine name back into one payload |
| widget-nap-emulator.test.js | --emulator | mint with emulator-issued tokens (disabled, validSince, non-member); a forged token costs zero reads; start, stop, undo, state; a stale start answers 409; Both partial states; 12h and 24h; clock validation; 403 baby; removed caregiver; purge; revoke; body tampering; rules deny widgetTokens | mutated worker.js: precondition in the query string, membership check removed, a delete Write for the clear, start check removed, stop split in two commits |
| widget-timer-race-emulator.test.js | --emulator | the real store-firebase.js client (start, stop, keep running, correct) racing the real Worker commit: no resurrected or erased nap, no ack-only timer, one event per nap, digit-led baby ids | the app back to a blind write; a random event id in stopSleep |
| deploy_exclusion_check | default + --live | native-ios and native-android never served | drop the .assetsignore line |
| widget-logger.test.js (F7) | default (puppeteer, local serve) | every log path stamps `by` with the signed-in uid; the export names another member's anchor and leaves this user's own unnamed; no name in lockScreen output or any pregnancy field | drop the stamp in addEvent; name the viewer's own entry |
| widget_since_parity (F2) | default | app and Worker anchors come from one shared module and agree on shared fixtures | change one rule in the Worker copy |
| key-file guard (pre-commit) | hook, asserted by hooks_check | no *.jks, *.keystore or keystore.properties is committed | stage a dummy .jks |

Builder call (16 Nov, se11): the race test replaces the planned blob-clobber extension; a mirror with a hand-modelled
server proves only that the mirror agrees with itself.

Mac-only, in the build scripts (abort on failure, red once, in docs/TESTING.md, named in test_wiring_check.js):
- Builder call (16 Nov, sy1): android_parity_check stays out of the default tier. It runs in a Mac-only release tier
  invoked by tools/cap_android_build.sh, after its absent-file false pass is fixed (:80-81 passes with no build.gradle).
- Builder call (16 Nov, sy17, sy18), iOS: appex in App.app/PlugIns and the exported IPA; its extension point; an explicit
  entitlements file per target; the same App Group in both; the keychain group with the literal prefix F5NVQV7NVB
  (cap_ios_build.sh:92 signs the file as written, so `$(AppIdentifierPrefix)` would ship unexpanded); appex
  CFBundleVersion equal to the host's. An XCTest renders every TimelineProvider family with ImageRenderer, and
  ios_launch_smoke.sh adds and renders the widget, not only the app. UX pass (16 Nov): the renders run at the floor
  sizes (321x148, 148x148), day and night, accented, and at xxLarge Dynamic Type, and the built Info.plist holds no
  UIApplicationShortcutItems.
- Android: receiver and provider in the merged manifest, a Glance render test, and the Kotlin golden tests. UX pass (16
  Nov): renders at 4x2 (276dp wide) and 2x2 (130dp), portrait and landscape; the merged manifest holds no static
  shortcuts.

## 7. Sequencing

D6: A first, B right after. F1: the app goes to App Review now without widgets; A, B and F2's freshness are built in
that order and ship together in the next iOS update (A alone is thin under 4.2). Android follows the moment its shell
signs in; until then the parity gate allows a declared iOS-only window.

Phase 0, foundations (nothing user-visible)
- Android shell, once the founder's prerequisites exist (F1): tracked `native-android/` copied in by script; `npx cap sync
  android` (the binary lacks Firebase auth, messaging, browser, share, filesystem, haptics); google-services.json; the
  upload keystore (founder). Builder call (16 Nov, se13): keystore, keystore.properties and signing passwords live in
  ~/.android-keys/, like ~/.appstore-keys/; .gitignore gains *.jks, *.keystore, keystore.properties; pre-commit gains a
  key-file guard. Then signingConfig, real versionCode, tools/cap_android_build.sh (AAB plus Mac-only gates), JDK 21, the
  SDK, Kotlin and Compose, backup exclusions. Exit: a proven sign-in in the Android shell. assetlinks.json comes later.
- iOS shell: cap_ios_configure.rb creates the CubbyWidget target idempotently after :288, embeds and depends, and sets
  CODE_SIGN_ENTITLEMENTS per target (the :316-335 loop hard-codes App/App.entitlements at :317) with matching
  MARKETING_VERSION and build number; writes the appex entitlements; adds the App Group to the :149-166 heredoc; registers
  the plugin through a CubbyBridgeViewController patched into Main.storyboard:14. cap_ios_build.sh signs the appex
  inside-out before :92 and runs the Mac-only gates. Portal: App ID com.littlecubby.app.widget, App Group
  group.com.littlecubby.app on both IDs (permanent). Expect one failed export (IOSV:378).
- App: stamp `by` on every new log (F7) before any widget ships, so names exist by launch; router targets pump,
  activity, measure, milestone, health, voice, sleepfix; the native-bridge whitelist and
  launch-URL clearing; QUICK_ACTIONS `widget` fields; widget-copy.json with rules and fixtures; generator and parity
  gate; per-person settings. UX pass (16 Nov): DESIGN.md gains the widget's night stroke pairs and `--on-sleep` rule
  (6.1) before any widget is drawn.

Phase A, display widgets; every tap opens Cubby
- Snapshot export, plugin, version handshake, wipes; medium, small, twins, lock screen (iOS); no pregnancy widget yet (F4); Edit
  Widget; illness switch and its in-app line (6.3); "Sleep ↗"; dynamic shortcuts; widget.opened. Also C6, as its own
  change with its own gate (dose push copy, 6.12).
- On-device checks: gallery, configuration, each button and its baby, empty state before first unlock, every wipe.

Phase B, Sleep in place
- First, running naps move to their own record for every family (C4), proven by the race test and live for a release
  before any widget writes. Then widgetTokens, mint, revoke, purge, TTL and rules; the nap route, emulator suite red then
  green; NapIntent and the Glance callback; pending, Undo, Checking, failure and long-nap states; Phase B labels.
- Phase A binaries keep working: "Sleep ↗" still opens the sheet, and no router target they emit is removed.

Cross-device freshness (F2): the snapshot route, the shared since-rule module and the silent push land with Phase B, in
the same iOS update. The Apple push key (C5) is a founder step before that build.

Pregnancy widget (F4): after CA3 ships and F2 is live; it then gets its own phase with the opt-in, the pregnancy
shortcuts and their wipes.

## 8. Copy

Voice: DESIGN.md §A1 and §A7. Warm, brief, second person, sentence case, no em-dashes, past tense; a failure always says
what to do next, in its words or in the button beside it (6.7). The number is fmtClock ("2:10 AM"); the ago line is the
system's live rendering on iOS and absent on Android (6.9). SPEC's "1h 05m" loses to the app. UX pass (16 Nov): every
row below was revised, and each string that sits in a tight slot was measured (6.1, 6.7).

| Where | String |
|---|---|
| Gallery | medium, Phase A "Feed, sleep, nappy" / "When your baby last fed, slept and had a nappy, and a tap to log the next."; medium, Phase B "Feed, sleep, nappy" / "When your baby last fed, slept and had a nappy. Start and stop sleep right here."; small "Last feed" / "When your baby last fed, and a tap to log the next one."; lock screen "At a glance" / "When your baby last fed and slept."; pregnancy (iOS) "Cubby" / "A quiet Cubby on your home screen." with a wordmark-only preview |
| Header | "Robin" / "2 months old" (ageString's words and singulars, index.html:2227) / "Updated 3:14 AM"; over 20 hours "Updated yesterday 11:50 PM"; twins: icon and "Updated 3:14 AM" only |
| Who logged (F7) | after the label, only when someone else logged it: "Last feed · Dad", "Last nappy · Priya"; small: on the ago line, "1 hr, 5 min ago · Dad"; never on the lock screen |
| Statuses | label "Last feed", "Last sleep", "Last nappy" / "2:10 AM" / ago line on iOS only, in the system's words ("1 hr, 5 min ago"); over 20 hours "Yesterday", the weekday or the date in place of the ago line; empty "not yet" |
| Sleep status | running: label "Sleep" / "Asleep now" ("Asleep" where it does not fit) / "since 2:40 AM"; long nap: the same, with "Did it end earlier?" in the header and the button "Stop sleep" with the arrow |
| Buttons | "Feed", "Nappy", "Pump", "Activity", "Health", "Say it" (Android), each with the arrow; Sleep: Phase A "Sleep" with the arrow; Phase B "Start sleep" or "Stop sleep", solid, no arrow; twins "Start both", "Stop sleep", "Stop both"; "Sleep" with the arrow when there is no token, just after a failure, and for siblings set to Both |
| In-place states | while a request runs the button dims and keeps its words (no "Saving"); "Undo" for 10 seconds after a tap; unknown outcome "Checking"; no connection "No connection, so that didn't save."; refused or unavailable "That didn't save. Open Cubby to log it."; after already:true or 409 "Already started in Cubby." or "Already stopped in Cubby." |
| Layouts | small "Robin · last feed" / "2:10 AM" / ago (iOS) / "Updated 3:14 AM"; lock screen "Last feed 2:10 AM" / ago / "Robin · woke 1:20 AM" or "Robin · asleep since 2:40 AM", inline "Last feed 2:10 AM"; twins rows "Robin" "Last feed 2:10 AM" (ago on iOS where it fits), "Wren" "Asleep since 2:40 AM" |
| Accessibility | VoiceOver and TalkBack labels, from widget-copy.json: "Feed for Robin, opens Cubby"; "Start sleep for Robin"; "Start sleep for Robin and Wren"; "Stop sleep for Wren"; "Sleep for Robin, opens Cubby"; status "Robin's last feed, 2:10 AM"; "Robin, asleep since 2:40 AM" |
| Fallbacks | stale over 6h "Open Cubby to catch up."; signed out "Cubby" / "Open Cubby to sign in."; missing or wrong baby "Open Cubby to pick a baby."; no data, unknown version, locked container, quiet "Cubby" only |
| Pregnancy | quiet "Cubby" / "Open"; opted in "Week 30" / "Third trimester" / "Next visit" / "Tue 14 Oct, 3:15 PM" or "around week 32"; buttons "Kicks", "Contractions", "Symptom", each with the arrow |
| Configuration | rows "Baby": names, and "Both" with two babies; "Your button": "Activity", "Health", "Pump", and "Say it" on Android; description "Feed, Sleep and Nappy are always on your widget. While your baby is unwell, your button shows Health, then goes back." |
| Helpers | iOS stack "One widget per baby? Turn off Smart Rotate so the stack stays where you left it."; in-app chooser "Who is this for?"; in-app, when an illness switches the button (6.3), "Your widget now shows Health until Robin is better." |
| App settings | "Hide details on the lock screen." helper "The widget will show Cubby and nothing else." / "Show my week on the home screen." helper "Your week and its shortcuts show on your home screen. Anyone who picks up your phone can see this. It stays off until you turn it on." |
| Shortcuts | "Feed", "Sleep", "Nappy", "Kicks", "Contractions", "Symptom", plus the label of the first chosen quick action that has a route and is not gated (6.10) |
| Never | "don't forget", "last chance", "time for", "streak", "goal", "Pro", an em-dash, a question mark on the lock screen (6.11) |

Every string above is compiled into a binary and goes through App Review; it cannot be recalled. Keep it in
widget-copy.json and nowhere else.

## 9. Left to the builder

- Exact SwiftUI and Glance layouts within the sketches and 6.1's layout floor, against the app's tokens, day and night,
  at the 321x148 and 148x148pt floor and at Android 4x2 and 2x2. UX pass (16 Nov): the exact margins (12 to 14pt), the
  small clock's size between 28 and 34pt per floor, and Android's layout choice by height in landscape.
- UX pass (16 Nov): whether .relative ticks seconds on an iOS 17 device, and the minute-only fallback if it does (6.9).
- UX pass (16 Nov): how long a failure or "Already" line stays (one timeline period, ending at the next snapshot or nap
  reply), and where the app's illness confirmation adds its one widget line (6.3).
- https Link or cubby:// on iOS, and small-widget Links on iOS 17 (else one target), proven on a device; Glance, or
  RemoteViews if Kotlin destabilises the build (record why in the plan).
- Which timer document path (6.7), and how older cached app builds' app.timers writes are folded in during the move.
- What the app's own Start and Stop do offline once they are transactions: say so plainly, never a blind write.
- How often the app re-stamps `at` while open and live with nothing changed, so a quiet night is not called stale.
- Plugin method names, rate-limiter numbers, retry backoff within the 10-second budget.
- The tracking-plan entry for `widget.opened`, and the SPEC revision note (buttons, Sleep labels, in place).
- Device registration or TestFlight for on-device testing (zero registered devices, build.sh:7-10).

## 10. The founder's answers, 16 November (were open questions)

Each was answered on 16 Nov; the answer is first (F1 to F6, also at the top), the reasoning that was put to him follows.

Q1. Release order. (br1, sy19, sy20) Answered F1: iOS first, as recommended.
- iOS first, with Android the moment its shell can sign in; or both together. Android needs three things only the
  founder can provide: a Play developer account, the upload keystore, and a Firebase Android app (google-services.json
  with signing fingerprints). A personal Play account made after Nov 2023 also needs a 12-tester, 14-day closed test.
- And the App Store: does the first submission go without widgets (the prior verdict, MPL:98), with Phase A, or wait for
  B? A alone only opens the app, which is thin under 4.2.
- Trade-offs: iOS first skips the long pole but needs a declared iOS-only window; together, iOS waits on undated steps.
- Recommendation: submit the app as it is now; widgets A and B ship together in the next iOS update; Android follows the
  moment its shell signs in, with the parity gate allowing a declared iOS-only window.

Q2. The partner's 3am log. (br2) Answered F2: server pull plus push, as recommended.
- Same-phone freshness only: the partner's 1am feed never reaches your widget until you open Cubby. Honest "updated"
  line, numbers hidden after 6 hours, no new server work.
- Server pull plus a silent push poke: the widget's refresh calls `GET /api/widget/snapshot` with its token; the Worker
  computes the contract from a since-rule module shared with the app (6.6's filters, the widget_since_parity gate). After
  any log, the Worker pokes the other members' phones so their widgets refresh now. Needs the Apple push key (C5) and FCM
  data messages on Android, and widens the token to one read.
- Trade-offs: the first is cheap and fails at exactly the moment section 1 describes; the second is the biggest server
  piece here after the timer move.
- Recommendation: the server pull plus push, because the two-caregiver handover is the wedge.

Q3. After a pregnancy loss in a family with a living child. (br4, ss5) Answered F3: keep the living child's times.
- The app keeps that child's Home for her ("you cannot lock a mother out of her living child's feed log",
  index.html:13670-13684) and sets loss holding for everyone the journey was shared with.
- Keep the living child's times and Sleep button on the widget, as Home does, with nothing pregnancy-related anywhere (no
  block, no shortcuts, neutral gallery); or go quiet, the wordmark alone, for both parents until she leaves the quiet view.
- Trade-offs: keeping them keeps the 3am answer in the weeks it matters most, with baby times on glass during
  bereavement. Quiet is gentler to look at but takes the glance from both parents until she finds "Everyday view".
  Recommendation: keep the living child's times.

Q4. The pregnancy widget's timing. (ss1, ss2) Answered F4: hold until CA3 and F2 exist. The founder's own words:
only the mother should have it.
- Until Q2's path exists, a loss recorded on another device (the installed PWA keeps its own storage, the web app, a
  second phone) leaves "Week 30" on this phone's glass until Cubby opens here; IOSV:366 names this the worst outcome.
- The opt-in belongs to the journey owner, who is the partner in 3 of 7 journeys until the carrier handover (CA3) is
  built, so he could put her week on his home screen.
- Options: ship it in Phase A as designed, or hold it until both Q2's path and CA3 exist. Recommendation: hold the
  pregnancy widget until both exist; ship the post-birth widgets first.

Q5. The Health switch. (ss4) Answered F5: automatic, with the 14-day return.
- Health replacing the fourth button is itself a sign on glass that a baby is unwell, readable by anyone who sees the
  home screen (hide-details covers only the lock screen). An illness nobody marks better keeps it for weeks
  (index.html:15272), and a parent whose button changed unannounced may land on the wrong sheet at 3am.
- Options: keep it automatic as D4 decided, or make it a setting the parent turns on. Either way, Health could return to
  the pick after 14 days with no illness entry.
- Recommendation: keep it automatic (it is what he asked for), and add the 14-day return.

Q6. Sleep or Nap. (sy3, sy25) Answered F6: Sleep.
- "Sleep" matches QUICK_ACTIONS, the PWA manifest and tools/shortcuts_check.js (manifest name equals the label). "Nap"
  means changing all three together, or the widget, the long-press shortcut and the app disagree. Recommendation: Sleep.

### What B costs, plainly

Running naps move out of the household blob into their own record for every family, whether or not they ever add a
widget (C4). That is an app change to starting, stopping, correcting and snoozing a nap, with a migration for older cached
builds, and the app's own Start and Stop then need a connection. On top of it sits a new widget sign-in token: mint,
native storage, revoke, purge, TTL. Those two are most of the B work; the nap route itself is small once they exist.

## Review log (16 Nov)

| Ids | Outcome | Section changed |
|---|---|---|
| br1, sy19, sy20 | founder answer F1 (sy20's 3.1.1 half became a deep-link gate assertion, 6.12) | 7, 10 |
| br2 | founder answer F2 | 1, 6.9, 10 |
| br4, ss5 | founder answer F3 | 6.6, 10 |
| ss1, ss2 | founder answer F4 (ss2's boot-paint half is guarded in 6.6) | 6.1, 6.6, 10 |
| ss4 | founder answer F5 | 6.3, 10 |
| br6, br8 | answered by founder decision (br6: C3; br8: D1 to D8, C1 to C7) | Founder decisions, 5, 6.7 |
| br5 | settled by builder call, flagged for the founder | 6.2, 6.5, 6.11, 8 |
| br7, ss11, ss12, sy14, sy15, sy24, sy25 | settled by builder call (sy25's word itself is F6) | Founder decisions, 6.1, 6.6, 8 |
| sy21 | settled by builder call | 6.4 |
| ss13, sy4, sy5, sy6, sy22 | settled by builder call | 3, 6.5, 6.12 |
| ss3, ss9, ss10, ss14, se4, sy8, sy12, sy13 | settled by builder call | 6.6 (and 6.7, 6.9, 6.10) |
| se1, se2, se3, se5, se6, se10, se11, se15, se16, se18, se20, ss8, ss15, sy7 | settled by builder call (se2, se3 carry out C4; ss8's partner half is F2) | 6.7 (and 5, 6.12, 8) |
| br3, se7, se8, se9, se12, se14, se17, se19, sy9, sy16 | settled by builder call | 6.8 (and 6.6, 6.7) |
| ss6, ss7, sy2 | settled by builder call (with C1, C2; ss7's partner half is F2) | 6.9 (and 6.1, 8) |
| sy3 | settled by builder call; the label is F6 | 6.10, 10 |
| ss16, sy10, sy11, sy23 | settled by builder call | 6.11 |
| se13, sy1, sy17, sy18 | settled by builder call | 6.12, 7 |

## UX pass log (16 Nov)

The design, copy and UX review of this doc and the 16 Nov board: 23 findings, numbered as the review numbered them.
None reopens D1 to D8, and none needed a new founder question: each was decided here and marked "UX pass (16 Nov)".

| Findings | Outcome | Section changed |
|---|---|---|
| 1 (elapsed headlines), 20 (copy) | mostly met by the revision; "Updated 3:14 AM", "2 months old", gallery copy and the "Already" lines added | 6.1, 6.7, 6.9, 8 |
| 2 (static shortcuts), 3 (pregnancy shortcuts) | dynamic-only already held; gate check, one switch for the week and its shortcuts, PWA manifest follow-up | 6.10, 6.11, 6.12, 8 |
| 4 (tap targets), 7 (overflow), 17 (contrast) | layout floor, unequal columns, type sizes, short "Asleep", truncation order, small clock, "not yet" ink | 5, 6.1, 9 |
| 5 (over-12h nap) | wording and button adopted; the app's 6-hour snooze exception kept, with the reason | 6.1, 6.5, 6.7, 8 |
| 6 (siblings and Both) | already met by sy21; the birth-date tolerance for twins added | 6.4 |
| 8 (Android ago line), 19 (time formats) | no ago line on Android; no seconds on iOS; the 20-hour day rule; fmtClock everywhere, 12-hour as Home | 5, 6.9, 6.11 |
| 9 (offline copy), 11 (no "Saving") | "No connection, so that didn't save." beside "Sleep ↗"; no "Saving" on either platform | 6.6, 6.7, 8 |
| 10 (affordance at night), 23 (Mobbin) | arrow on every opens-Cubby button, overriding sy25; night strokes; `--on-sleep`; accented mode; 11pt arrow; quiet fourth slot; banned phrases; writing-intent check | 6.1, 6.11, 8 |
| 12 (twins cell), 13 (board caption) | rows with names, "Asleep since" per row, twins Sleep labels; the caption is a board change only | 6.1, 6.4, 8 |
| 14 (Edit Widget), 15 (silent switch) | "Your button", the system sheet's one description, Android configuration_optional, the in-app line | 6.2, 6.3, 6.11, 8 |
| 16 (fourth shortcut) | first chosen action with a route and no gate; measure and milestone routes; Say it gated; deep-link gate covers shortcuts | 6.5, 6.10, 6.11, 6.12, 7 |
| 18 (C4 against 6.7) | already met by the revision's timer document | none |
| 21 (C6 has no place) | G7, a dose push copy gate | 2, 6.12, 7 |
| 22 (phase names) | already met: section 7 reads Phase 0, A and B | none |
