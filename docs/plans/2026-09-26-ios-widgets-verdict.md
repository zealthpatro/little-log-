# iOS widgets for Cubby: do we have them, and should we build them

**2026-09-26.** Question from the founder: *do we have widgets for the iOS app, something like Apple's Batteries widget, for quick actions during pregnancy and post birth?*

**Answer: no, none, on either stage.** What follows is the staged plan if we did, and three adversarial reviews of it. The reviews disagree with the plan and they win. Produced by a 7-agent workflow; every load-bearing claim re-verified by hand afterwards.


---

## The proposal

## Widgets for Cubby: the answer, and a staged plan

**No. There are zero widgets today, on either stage.** No WidgetKit, no AppIntent, no ControlWidget, no App Group. `ios/App/App.xcodeproj` has exactly one target and `tools/cap_ios_configure.rb:190` is written to abort if it ever finds anything else. The iOS app also has no notification quick actions, despite a comment at `app/sw.js:96` claiming the dose "Log it" button "reaches iOS through the native wrapper's UNNotificationCategory". There is no `UNNotificationCategory` anywhere in the repo. That comment is false and should be corrected whatever you decide here.

Worth saying plainly before the plan: **your reference image is a read-only widget.** Apple's Batteries widget has no buttons. It is several statuses at a glance and nothing else. That matters, because the buttons are where the cost is and the statuses are where the value is.

---

## 1. Three different projects hide behind the word "widget"

| | What it is | First thing it needs that does not exist | Size |
|---|---|---|---|
| **The doorway** | A widget on the Home Screen with four tap targets that open Cubby straight to a feed, a nappy, a nap. Shows no numbers. | A second Xcode target, scripted | ~8 days |
| **The mirror** | "Fed 1h 5m ago. Nappy 40m ago." The Batteries shape. | App Group + a new Capacitor plugin | ~+7 days |
| **The button** | Tap "Nappy" on the widget and it is logged without opening the app. | A write path the auth model deliberately does not have | ~+6 to 14 days, and it is not honest until the last variant |

`docs/plans/2026-08-15-tracking-gaps-and-proposals.md:214` already ranked the mirror **#38 of 38, "do this last"**, with the stop rule at `:321`: *a widget amplifies a logging habit, and eleven households have not formed one.* That reasoning has got stronger, not weaker. On the numbers you have (12 households, 14 lifetime events, nothing since 2026-08-15), the mirror widget on a real Home Screen today would read **"Fed 6 weeks ago."** That is worse than no widget.

So the plan below is real and buildable, and the recommendation at the end is to build only the first step of it now.

---

## 2. Post-birth and pregnancy are not the same widget

**Post-birth: yes, the Batteries shape is exactly right.** Three independent statuses, each a label and a number, no interpretation, no judgement. Home already computes all three (`sinceCard`), so there is nothing to invent. It is the one place in Cubby where a glance genuinely answers the question the parent has ("when was the last one"), and it answers it without opening anything. A medium widget holds three rows comfortably. For twins, the same shape flips to two babies and one status, which is arguably the stronger case, but there are not enough twins in a twelve-household base to build for first.

**Pregnancy: no, the multi-status shape is wrong, and a full-size pregnancy widget is wrong.** Three reasons:

1. **Almost every pregnancy status is private in a way post-birth statuses are not.** Kicks, contractions, symptoms, weight, blood pressure, glucose, supplements all live in the owner-only journey doc or the maternal-health docs. Mood is owner-only forever and is blocked from sharing in code, in rules, and even from generating a toast for a non-owner. A five-status pregnancy widget is a maternal-health dashboard rendered on glass that anyone in the room can read.
2. **It fails the Anxiety Test on its worst day.** A grid of kick counts and blood-pressure readings on a Home Screen is "a medical dashboard", which DESIGN.md §A1 names as the thing Cubby is specifically not. Pregnancy is one thing at a time.
3. **The bare fact of a pregnancy is the secret.** "Week 9" on a Home Screen outs a first-trimester pregnancy to anyone who glances at the phone. That collides with the mother-owned-privacy position the whole product is built on.

So pregnancy gets **a small widget, one fact, opt-in, off by default**: the week, and the next visit. Nothing clinical, ever.

---

## 3. The stages

| Stage | What it is | iOS floor | Days | First needs |
|---|---|---|---|---|
| **0a** | Pre-flight: custom URL scheme, a Shortcuts tile, and the missing `?go=` targets | any | 1 to 2 | nothing new |
| **0b** | **The doorway widget.** Static, four quick actions, no data | 15 | 7 to 9 | a second Xcode target, inside-out signing |
| **1** | **The mirror.** Last feed, nap, nappy. Running timer ticks | 15 | 6 to 8 | **App Group + a new Capacitor plugin** |
| **2** | Lock Screen and StandBy, reusing stage 1's data | 16 / 17 | 2 to 3 | nothing new |
| **P** | The pregnancy widget, opt-in | 15 | 3 to 4 | stage 1 |
| **3** | Buttons that queue, drained on next app open | 17 | 5 to 7 | nothing new, but a real conflict model |
| **4** | Buttons that write immediately | 17 | 5 to 7 | **writing a family's record from native code** |
| — | Real-device QA and the first App Store submission | | 3 to 5 | a registered device UDID (you have zero) |

---

### Stage 0a. Pre-flight, before a line of Swift

**What the parent sees:** nothing new in Cubby. This is for you.

**What is built:** one PlistBuddy line beside the existing `CFBundleURLSchemes` block in `tools/cap_ios_configure.rb:109` to add a `cubby://` scheme, plus the three missing deep-link targets in `app/index.html` (`?go=pump`, `?go=dose`, `?go=note`, and a bottle/breast preset on `?go=feed`). Ships over the air for the web half, in the next ordinary build for the scheme.

**Why it comes first:** you can put a Shortcuts "Open URL" tile on a real Home Screen the same afternoon and measure the thing that decides whether any widget is worth building: **how long it takes from tap to the feed sheet being open.** The path is launch app, load the remote page from the service-worker cache, restore auth, wait past sign-in, then open the sheet. That is seconds, not instant. If it feels bad on a real phone, every stage below inherits that feeling and the project is dead for a day's spend instead of two weeks'.

It also closes a gap that would otherwise make the widget look half-built: today the router reaches feed, nappy, sleep, temp and visit, and cannot reach a pump, a dose, a note, a photo or a milestone.

**What could go wrong:** `new URL()` on a non-special scheme inside the webview. Ten minute test. Universal `https://` links from Shortcuts may work with no scheme at all, which would make this half a day.

---

### Stage 0b. The doorway widget

**What the parent sees:** a medium Cubby widget on the Home Screen. A soft cream card, the bear, four tap targets: **Feed, Nappy, Sleep, Say it.** Tapping one opens Cubby with that sheet already up. No numbers anywhere on it, so nothing on it can ever be wrong or stale.

**What is built, in this repo:**
- A new tracked source directory for the Swift (`ios/` is gitignored at `.gitignore:26`, so anything clicked in Xcode dies on the next `npx cap sync`).
- `tools/cap_ios_configure.rb`: create the Widget Extension target programmatically via Xcodeproj, give it a second bundle id, its own Info.plist and entitlements, add its Swift sources to its build phase, add an embed-appex phase to `App`, and set `DEVELOPMENT_TEAM` and `CODE_SIGN_STYLE` on **its** build configurations as well. Today lines 213 to 231 only touch `App`.
- `tools/cap_ios_build.sh`: sign the `.appex` inside-out before the outer app, and **extend the assertion loop at lines 75 to 88 to inspect the `.appex`, not just `$APP`**.
- A reviewable copy file plus a check that the Swift string literals match it, wired in beside `type_check.js`.

**iOS floor:** 15. Per-element `Link` targets only work in medium and larger, so a four-action grid must be a medium widget. A small widget is one tap target for the whole tile.

**Days:** 7 to 9. Roughly two thirds of that is Ruby and shell, not Swift.

**This same target is what the Live Activities plan's phase 1 needs.** The build-system spend is not widget-specific and is not wasted if you later do Live Activities instead.

**What could go wrong:**
- The archive is produced with `CODE_SIGNING_ALLOWED=NO`, so a nested `.appex` comes out unsigned and the current guard would pass green on a broken build. That is the exact failure class that ate builds 1 to 5 and that shipped `aps-environment=development` for months. The new assertion has to be shown going **red** on a deliberately mis-signed appex before it counts.
- Second App ID and profile on the portal, and you have no registered device UDIDs, so on-device verification is blocked until that is fixed.
- **App Review 4.2.** A widget that is only four launch buttons reads thin. It is native functionality, which helps a wrapper whose `webDir` is a 916 byte meta-refresh, but four icons that open the app is not much of an argument on its own.

---

### Stage 1. The mirror. This is the Batteries widget

**This is the first stage that requires an App Group, and the first that requires a new Capacitor plugin. They cannot be split: the plugin is how the web app gets a number into the container and how the widget is told to redraw.**

**What the parent sees:** the same card, now with three rows.

> **Ava**
> Fed · 1h 5m ago · 2:10
> Slept · 2h ago · 12:40
> Nappy · 40m ago · 3:30

And when a nap is running, the top row becomes a live ticking clock. `Text(timerInterval:)` is interpolated by the system frame to frame from one payload, so that counter costs zero refreshes and stays correct with the app closed.

**What is built:**
- A local Capacitor plugin package in the repo with one method, so `npx cap sync` regenerates it.
- `tools/cap_ios_configure.rb`: the app-group key added inside the entitlements heredoc at lines 74 to 89, for **both** targets. That file is rewritten on every build, so a key added anywhere else evaporates.
- `app/store-firebase.js`: a mirror write hooked where `pushNow` already runs, serialising a tiny versioned projection. **Text only. No image bytes, ever.** The vaccine card photo never leaves the device and neither does anything else.
- `app/index.html`: wipe the container on sign out, on `endPregnancy`, and inside the account-deletion path. An App Group snapshot is a second copy of household data outside the webview's storage jar, so the A6 deletion rule ("private records deleted first") has to grow a new limb or deleting your account leaves your baby's last feed time on the Home Screen.

**iOS floor:** 15. Choosing which baby needs an AppIntent configuration, which is iOS 17. Before that the widget follows the per-device `activeBabyId` already in `little-log-prefs-v1`.

**Days:** 6 to 8.

**What could go wrong, and one of these is structural:**
- **Cross-caregiver freshness.** The snapshot is only written while the app is open. If Papa logs a nap on his phone, Mama's widget keeps saying the old thing until *she* opens Cubby. Same honest gap as phase 3 of the Live Activities plan, and there is no native Firestore listener to close it.
- **A runaway counter.** The app caps a sleep display at 24h and nudges at 12h for a reason. A widget's ticking clock has no system reaper, so a nap nobody stopped will read "14h 22m" on the Home Screen at breakfast. It has to stop counting and change its words, or it is a small accusation that renews itself every morning.
- **Version skew is a wire protocol you cannot recall.** The web app ships by pushing main and is live in minutes. The widget binary is frozen at App Review. From the first widget ship, the App Group JSON is a contract between a rolling deploy and a binary you cannot pull back. A field rename lands a wrong number on a Lock Screen at 3am, which is the exact moment the charter is written about. Version the payload and have the widget **refuse to render an unknown version** rather than guess.
- **The App Group id is permanent.** Changing it later orphans every installed app's container.
- After a reboot and before the first unlock, the container is unreadable and the widget renders a placeholder. Design a real empty state, not a zero.

---

### Stage 2. Lock Screen and StandBy

**What the parent sees:** one line above the clock, or a small block below it: "Fed 1h 5m ago". And when the phone is charging on its side on the nightstand, which is the night-feed scenario exactly, StandBy reuses the small widget for free. Night Mode tints it red, so it has to be legible red on black.

**iOS floor:** 16 for Lock Screen accessories, 17 for StandBy. **Days:** 2 to 3, because the data already exists from stage 1.

**What could go wrong:** Lock Screen widgets render while the phone is locked and do **not** honour the notification "show previews when unlocked" setting. Assume anyone who picks up the phone reads it. `.privacySensitive()` exists, but the precise conditions under which WidgetKit applies privacy redaction are worth confirming on a device and should not be designed around. This is where the per-person "hide details" setting earns its keep, and it must be a personal preference (localStorage by uid, or `users/{uid}`), **not** `state.settings`, which is the shared blob.

---

### Stage P. The pregnancy widget

**What she sees, and only if she has turned it on:**

> **Week 27**
> Your next visit is Tuesday at 3:15.

That is the whole widget. Small size only. Nothing clinical, no kick counts, no blood pressure, no symptoms, no mood, no countdown to the due date, no "days remaining" bar.

**iOS floor:** 15. **Days:** 3 to 4, on top of stage 1.

**What could go wrong, and one of these is the single most important line in this document:**
- **After a loss, a widget that still says "week 27" is the worst thing this product could do.** `endPregnancy` and the loss-holding path must wipe the container synchronously, and the widget must render nothing but the wordmark when the payload is absent. This needs a test that goes red before it goes green.
- The opt-in is not a preference, it is a disclosure. Default off, with plain words about who can see it.
- Installing a Cubby widget at all says something about you. That is a real first-trimester consideration and no setting fixes it.

---

### Stage 3. Buttons that queue

**What the parent sees:** the widget grows a "Nappy" button. Tapping it marks the row optimistically and the log lands for real the next time anyone opens Cubby.

**What is honest about it, and what is not:** a queued log is not a shared log. The parent taps, gets a checkmark, and nothing reaches the co-parent's phone, the timeline or the doctor report until the app is launched. **For a product whose wedge is two people seeing the same thing, that is a different feature than the button appears to offer.** Timers are worse: a "start nap" button that takes effect at next open will fight a phone that actually started one, and `applyAppBlob` already refuses to overwrite `state.timers` while a local push is pending.

**iOS floor:** 17 for `Button(intent:)`. **Days:** 5 to 7.

**What could go wrong:** buttons on a Lock Screen widget are inert until the person authenticates. Do not sell one-tap-at-3am. That is the moment it is least likely to work, and the Live Activities verdict already recorded the same rule.

---

### Stage 4. Buttons that write immediately

**This is the first stage that writes a family's record from native code.** Not via the Firebase SDK. `capacitor.config.json` sets `skipNativeAuth: true` deliberately, which is what makes sign-in work in a WKWebView at all, so there is no native identity to write with and undoing that is off the table.

The only shape that works is the one the repo has already built once for dose-from-notification: the Worker mints a short-lived HMAC ticket, the widget POSTs it, and the Worker writes with admin credentials, idempotent on a deterministic doc id.

**The problem is not feasibility, it is that admin writes bypass `firestore.rules` entirely.** The ticket's claims become the only access control on a write primitive into someone's family record. And the ticket has to live as long as a parent might go without opening the app, which for this user base is days. `docs/plans/2026-08-13-dose-from-notification.md` rejected long-lived device capabilities at rest on purpose.

**Days:** 5 to 7. **Recommendation: do not build this.**

---

## 4. The three thresholds, stated plainly

- **App Group: first required at stage 1.** Stage 0b does not need one. Once created, the id is permanent.
- **A new Capacitor plugin: first required at stage 1**, in the same commit as the App Group. Nothing installed can write a shared container. `Filesystem` writes the app's own container, not the group.
- **Writing to Firestore from native code: first required at stage 4, and only stage 4.** Stage 3 writes to the App Group and the web layer does the Firestore write on next open.

---

## 5. Proposed copy

Every string below compiles into the binary and ships through App Review, which inverts how every other word in Cubby ships. `marketing_type_check.js` cannot see them, so they go into the copy review by hand and the string count stays small on purpose.

**In the widget gallery**
- Quick log. "Open Cubby straight to a feed, a nappy or a nap."
- Today. "The last feed, nap and nappy, at a glance."
- This week. "Your week, and your next visit."

**The doorway widget (stage 0b)**
Feed · Nappy · Sleep · Say it

**The mirror, post-birth (stage 1)**
- Fed · 1h 5m ago · 2:10
- Slept · 2h ago · 12:40
- Nappy · 40m ago · 3:30
- While a nap runs: Napping · 47m
- Over twelve hours: "This nap is still running. You can fix the time in Cubby."
- Older than a day, show the day and drop the hours: Fed · Tuesday
- Empty: "Nothing logged yet." and "Tap to add the first one."
- No payload, or a version it does not know: "Cubby" and nothing else.

**Lock Screen (stage 2)**
- Rectangular: Fed 1h 5m ago / Nappy 40m ago
- Inline: Fed 1h 5m ago

**Pregnancy (stage P)**
- Week 27
- Your next visit is Tuesday at 3:15.
- After a loss, or with no journey: the wordmark alone.

**Settings, in the web app, so these stay changeable over the air**
- "Show Cubby on my home screen"
- "Hide details on the lock screen." Helper: "The widget will show Cubby and nothing else."
- "Show my week on the home screen." Helper: "Anyone who picks up your phone can see this. It stays off until you turn it on."

Sentence case, no em-dashes, no shouting, numbers humanised, past tense only. Nothing on any surface says what was not done.

---

## 6. What I would not build, and why

1. **Any "due", "next feed at", or wake-window countdown on a widget.** The tracking doc's explicit not-doing list bans streaks, counts of what was missing, completion rings and due times. A widget is the single most exposed place to break that rule.
2. **`accessoryCircular`.** Every honest use of a circular Lock Screen slot is a gauge, and a gauge of a parent's logging is a completion ring by another name.
3. **`systemLarge` and `systemExtraLarge`.** Not enough honest content to fill large, and the iPad audience is zero.
4. **A kick-counter button, at any stage.** `state.pregnancy.kicks` rides inside `syncPregJourney`'s whole-document `.set()`, so a widget write would be a last-writer-wins overwrite of the entire journey (due date, appointments, birth plan, bag) from a process that cannot read the current value. Displaying the week is fine. Writing a kick is not, against this schema.
5. **Mood, anywhere, ever.** Owner-only forever, blocked in code and in rules, and the deep link is deliberately swallowed for non-owners so that even a toast cannot leak that the record exists.
6. **Drug names, temperatures, blood pressure, illness day counts, or the "test: positive line" chip on any glass surface.** The drug-name rule is already standing from the Live Activities verdict.
7. **Any photo in the shared container.** No baby avatar, no scan, no vaccine card. Text only, permanently.
8. **A "two people logged today" or circle-activity widget.** Two people logging on the same day has happened zero times in twelve households. A widget that renders that fact is the cruelest surface this product could ship.
9. **Android app widgets.** Struck for the same reasons the Live Activities verdict struck Live Updates: there is no shippable Android app.
10. **A watchOS widget.** Live Activities render in the watch Smart Stack for free. A *widget* does not. It needs a watchOS app target with its own extension, which is a separate product, not a rendering.
11. **Any third-party measurement of widget impressions.** The deep link carries `src=widget` into the first-party event stream that already exists, and that is all. Never a pixel.

---

## 7. What I would do

**Now, this cycle: stage 0a only.** One or two days, no App Review, no new target, and it answers the question that decides everything else, which is how a tap-to-sheet actually feels on a real phone. Fix the `sw.js:96` comment in the same commit.

**Then submit the app.** It has never been submitted. A first submission carrying a brand-new extension target multiplies the provisioning and inside-out-signing failure surface on the one attempt where you most need a clean answer.

**Hold stage 0b as the prepared reply to a 4.2 rejection.** 4.2 minimum functionality is the live risk for a binary whose `webDir` is a 916 byte meta-refresh, the standard rejection asks for native iOS features by name, and a widget is unambiguously one. If the rejection comes, you have a scoped eight-day answer ready. If it does not, you have not spent the eight days.

**Do not start stage 1 yet.** Not because it is wrong, but because the widget you are picturing gets its value from a number, and right now that number would be "fed six weeks ago". A widget amplifies a logging habit. Build it when day-two return has moved, and it will be the right thing then, built on a target stage 0b already paid for.

---

Files that would change, all under `/Users/m1promax/Downloads/little-log-pwa`: `tools/cap_ios_configure.rb`, `tools/cap_ios_build.sh`, `app/index.html`, `app/store-firebase.js`, `app/sw.js` (the false comment at line 96), `.gitignore`, `package.json`, plus a new tracked Swift source directory and a new local Capacitor plugin package from stage 1 onward.


---

## Adversarial review 1

# Adversarial review: widgets for Cubby

## Verdict

**The proposal's conclusion is right and its reasoning is one layer too shallow. Do not build any widget stage, including 0b, this cycle. But the reason is not "the number would read fed six weeks ago." It is that the number the whole ranking rests on is a measurement of an outage, not of demand, and the widget has no delivery channel to a single living user.**

---

## 1. The widget has no addressable population, today or after stage 0b

A widget ships only inside a signed native binary. The app has never been submitted, and `docs/plans/2026-08-21-live-activities-verdict.md` records zero registered device UDIDs. All 18 signed-in users are on web or the installed PWA. So the reach of stage 0b on the day it lands is: App Store submission, review, a user installing the native app, opening it, entering jiggle mode, finding Cubby in the widget gallery, choosing a size, and placing it.

Every one of those steps is a harder action than opening the app and tapping Feed. That is not a probability argument, it is structural: **widget adoption is strictly downstream of the behaviour Cubby does not have, so the widget's addressable population is by construction the people who do not need it.** The proposal states this as a vibe inherited from the tracking doc ("a widget amplifies a logging habit"). It is stronger than that, and it kills the first-log steelman before you get to it (section 5).

## 2. The data is measuring a broken door

Last logged event: 2026-08-15. Four days later, `docs/postmortems/2026-08-19-installed-ios-pwa-cannot-sign-in.md` confirmed P0: **every iOS home-screen install could not sign in, by any method**, and `installRowHtml()` was advertising the install *on the sign-in card itself*. Household creation requires a successful first sign-in, so the funnel's 12 are survivors of sign-in #1; the trap fires on sign-in #2, inside the installed container. That produces exactly the observed shape: signed in, added a baby, never logged, never came back.

The postmortem's own follow-up list says so, unticked: *"Re-check the 11 churned households against `tools/analytics.js`: 282.6h median to first log, 0 sticky, against iOS installs. Some of that funnel may be this bug, not disinterest."*

It gets worse for the ranking:
- The real fix (in-container code exchange) shipped 2026-08-19 to 08-22 (`6dc7d800`, `1aca1fb0`), then **broke again** on 2026-08-23 (`c1e2057c` "Nobody could get a sign-in code: the wrong OAuth scope, again").
- `32d3f075` (08-31) "A signed-in parent must never be handed back to the door" is a further sign-in fix after the data window closed.
- `6fa6c53e` "Improve Today hierarchy and **quick logging controls**" was committed 2026-09-08 and **sat unpushed for 16 days**; it only went live on 2026-09-24 (`c5e7c152`). Two days ago.

**The build that exists today has been in front of zero new households.** Ranking a widget against 37 other items using pre-08-15 numbers is ranking with an instrument that was pointed at a locked door. This does not rescue the widget. It demotes the entire ranking exercise, including the stop rule that parked it.

## 3. The stop rule as written can never fire

"Build it when day-two return has moved." Day-two return cannot move: 0 active users, no acquisition running, and the only cohort that could move it does not exist yet. That is not a stop rule, it is a burial with a polite sentence on top. If the widget is genuinely deferred rather than killed, attach the rule to something with a mechanism: *N new households on the post-2026-09-24 build, with D1 measured.*

## 4. Corrections and misses in the proposal

1. **The custom URL scheme in stage 0a is probably unnecessary work.** `applinks:little-cubby.com` is already in `ios/App/App/App.entitlements`, the Worker already serves the AASA (`worker.js:2246`), and `app/native-bridge.js:167-173` already routes universal links on both warm (`appUrlOpen`) and cold (`getLaunchUrl`) launch into `routeDeepLink`. A widget `Link` to `https://little-cubby.com/app/?go=feed` needs no scheme at all. Demote it to a fallback.
2. **"One PlistBuddy line" is wrong.** `tools/cap_ios_configure.rb:106-110` does `Delete :CFBundleURLTypes` then rebuilds a single dict whose only scheme is Google's reversed client id. A `cubby://` scheme is 3 or 4 commands as its own URL type, or it shares a dict with Google's auth callback. Minor, but the estimate is built out of lines like this.
3. **The latency stage 0a wants to measure is already legible in source.** `maybeRunDeepLink` refuses while `window.LL.needsIdentity` or `#llAuthOv` exists, then `setTimeout(…, 350)`; `scheduleDeepLink` polls at 250ms with a 20s budget that only starts once nothing is blocking (`app/index.html:2647-2735`). Floor is remote load + auth restore + up to 250ms + 350ms. Ceiling is never, if sign-in is in the way. Worth measuring, but the proposal frames it as unknown.
4. **The biggest miss: three storage jars, not two.** The widget's tap lands in the Capacitor WKWebView, a third container separate from Safari and from the installed PWA. That partitioning *is* the root cause in the 08-19 postmortem, and `docs/postmortems/2026-08-21-signin-email-code-and-link.md` records that `isStandaloneApp()` is false in the wrapper, so it took the link path by accident of two negatives. A PWA user who installs the native app to get the widget signs in again, in a jar that has broken twice. **The most likely real-world outcome of tapping the doorway widget is a sign-in screen, not a feed sheet.** The proposal never mentions this.
5. **`sw.js:96`.** The correction is right, but the more important half of that same comment is that `actions` is Chromium-only, so the dose "Log it" button does not exist on any iPhone today by any route. Fix the sentence without noticing that and you leave the impression iOS has a notification action it does not have.
6. **Point 9 (Android) is stale in its reason.** `docs/plans/2026-08-31-multiplatform-launch-readiness.md` and `aaaa60aa` say there is nothing to port; there are six release-path gaps, one silent (`google-services.json` absent, so a Play build installs and cannot sign anyone in). Striking Android widgets is still correct; say it is the release path, not "no app".
7. **Stage P is buildable but the copy is over-specified.** Appointments now carry a real booked date (`a.when`, `apptWhenLabel`, `pregNextAppt` guards on it past 40 weeks), so "Tuesday at 3:15" is producible. It is not producible from a week-numbered estimate, which is the common case, and rendering a guessed weekday on a Home Screen is the pregnancy version of the stale-nap problem.

The privacy reasoning in section 2 (pregnancy is one fact, opt-in, off by default, nothing clinical) and the loss-wipe requirement in stage P are the strongest parts of the document and I would not change a word of them.

## 5. Steelman: is there a widget that attacks first-log?

**No, and the failure is an API fact, not a judgement call.**

The only mechanism by which a Home Screen widget could affect a *first* log is ambient cue, not shortcut speed. You cannot shorten a path nobody is on. And that cue already exists, cheaper: the app icon, for anyone who installed the PWA. It did not work. Worse, the install was being actively advertised into a sign-in trap, so we do not even know it was tested.

The nearest honest steelman is "make widget placement part of first run", and it dies immediately: **iOS has no API to place a widget on the Home Screen for the user.** Placement is manual, in jiggle mode, from the gallery. Asking a parent in the first week to do that during setup is more friction than the log you are trying to get. Verify that API fact before relying on it, but I am confident.

**The version of "quick actions" that survives the steelman is not a widget: it is Home Screen quick actions on the icon that is already on her phone.** Long-press Cubby, get Feed / Nappy / Sleep. Zero adoption action, zero placement, no gallery, no jiggle, and it reaches every install automatically the day the binary ships. That is the feature the founder's question is actually describing, and the proposal never considers it.

Cost, honestly: static `UIApplicationShortcutItems` is roughly half a day using the PlistBuddy block already at `tools/cap_ios_configure.rb:100-147`, no second target, no App Group, no second bundle id, no profile, no inside-out signing. But static items are wrong for a pregnant user, and the router's `BABY_GO` map is gated on `hasBaby`, so she would tap Feed and get silence. Making them stage-aware needs dynamic `shortcutItems` set from the web layer, which is a small custom plugin: no entitlement and no shared container, but not free. Call it 2 to 3 days all in, against 8 to 9 for the doorway widget, reaching everyone instead of the few who place a tile.

Also free and missing: `app/manifest.webmanifest` has no `shortcuts` array at all. That is an hour, ships over the air with no review, and gives Android and desktop installs the same long-press menu. iOS Safari does not honour it, so check on a device before claiming otherwise.

## 6. What I would build instead

**Option 1, recommended: buy one clean cohort. No Swift at all.**
- Run the 60-second device test still listed as "Not yet verified" in the 08-19 postmortem: an installed iPhone PWA and the native wrapper each signing in and staying signed in. The path has broken twice.
- Ship the still-open sign-in telemetry (attempt / success / failure, with method and `display-mode`). Twice now the absence of it meant a founder found an auth outage before the system did.
- Get 20 to 30 new households onto the post-2026-09-24 build, through whatever the PAID-TEST playbook says.
- Re-run `tools/analytics.js`. Until that exists, every prioritisation argument, including this review, is theatre.

**Option 2, if the cycle must ship native: submit the app, and put quick actions in the same binary.** The missing `?go=` targets (pump, dose, note, a feed preset), the manifest `shortcuts` array, home-screen quick actions on the icon, and the `sw.js:96` correction. Days, one target, no App Group, no second bundle id, and it is unambiguously native iOS functionality for the 4.2 argument, with the added virtue that it works for every install instead of the subset who place a tile.

I agree with the proposal on sequencing: **submit first.** A first submission carrying a brand-new extension target multiplies the provisioning and inside-out-signing surface on the one attempt where you most need a clean answer, and `tools/cap_ios_build.sh:69-88` inspects only `$APP`, so a mis-signed `.appex` passes the guard written to stop exactly this.

## 7. What would change my mind

- **A 4.2 rejection naming native features.** Then build 0b as the scoped reply. The proposal's reserve plan is correct and I would keep it on the shelf exactly as written.
- **25+ new households on the post-09-24 build with D1 above ~30% and a modal first log inside an hour.** Then the mirror is the right next thing, and by then the widget target may already be paid for by the Live Activities work.
- **Evidence that a material share of the churned 12 were iOS installs that hit the sign-in trap.** That does not resurrect the widget; it invalidates the ranking that parked it, and the whole 38-item list needs re-ranking on real data rather than this one item re-litigating.
- **Live Activities shipping first for the ritual or dose work.** That pays for the second Xcode target, the inside-out signing, and the `.appex` assertion, dropping 0b to 2 or 3 days. That changes the cost argument. It does not change the demand argument.

Files referenced, all under `/Users/m1promax/Downloads/little-log-pwa`: `docs/postmortems/2026-08-19-installed-ios-pwa-cannot-sign-in.md`, `docs/postmortems/2026-08-21-signin-email-code-and-link.md`, `docs/plans/2026-08-21-live-activities-verdict.md`, `docs/plans/2026-08-15-tracking-gaps-and-proposals.md`, `docs/plans/2026-08-31-multiplatform-launch-readiness.md`, `tools/cap_ios_configure.rb`, `tools/cap_ios_build.sh`, `tools/funnel.js`, `tools/analytics.js`, `app/native-bridge.js`, `app/index.html`, `app/manifest.webmanifest`, `app/sw.js`, `worker.js`.


---

## Adversarial review 2

Reviewed against `/Users/m1promax/Downloads/little-log-pwa` (main tree, not the worktrees).

## Verdict

The recommendation — 0a now, submit, hold 0b — survives. Most of the risk register is real and well aimed. But **the effort numbers are low on every stage that touches the build, and stage 1 as designed does not produce a working mirror widget.** Two of its named failure modes are not risks to mitigate, they are the default behaviour of the hook point it picks.

---

## 1. Stage 1's mirror hook is wrong, not optimistic

**"A mirror write hooked where `pushNow` already runs."** `scheduledPush` returns early on `applyingRemote` (`app/store-firebase.js:2191`), and every remote arrival is applied under that flag — the household blob at `:1921`, the events snapshot at `:1964-1990`. So:

> A co-parent's log never triggers a mirror write, **even with the app open in the foreground.** The widget updates only when *this device* writes.

The proposal calls this "the same honest gap as phase 3 of the Live Activities plan — Mama's widget keeps saying the old thing until *she* opens Cubby." That understates it. Opening Cubby does not fix it either; only logging something does. For a product whose wedge is two people seeing the same thing, a widget that structurally cannot show the other person's log is a different feature than the one described.

**The same bug makes the document's own worst case certain.** `endPregnancy` (`app/index.html:13223-13282`) ends with `persist(); closeSheet(); render();`. `persist()` is the 350 ms-debounced `scheduledPush`, and `pushNow` returns on `!hhRef` (`:2197`) and `!hhHydrated` (`:2202`). On the **co-parent's** phone the loss arrives as a remote blob under `applyingRemote`, so their container is never rewritten at all. "Week 27 on a Home Screen after a loss" is not a risk under this design — it is what happens. The wipe has to be a direct synchronous call in `endPregnancy`, the loss-holding path, `window.LL.signOut` (`store-firebase.js:846-849`) and `doDeleteAccount` (`app/index.html:8443`), **and** on the receiving device, which is the case nothing in the proposal covers.

This is one hook point in the estimate and is really three writers plus four wipers plus a cross-device path that does not exist.

## 2. "Fed · 1h 5m ago" cannot be kept truthful for free

`fmtSince` (`app/index.html:2124-2135`) is minute-granular for the first hour and minute-granular inside each hour to 24h. `Text(timerInterval:)` renders a clock (`HH:MM:SS`) — it solves the *running nap*, which the proposal correctly claims, and nothing else. `Text(_:style:.relative)` renders Apple's wording, not Cubby's. Matching the app means a pre-computed timeline with per-minute entries; bounding it means coarsening past the first hour, at which point the Home Screen and the Home screen disagree about the same fact. That is a copy decision hiding inside an effort estimate, and the three-surface rule breaks inside one product. Not in the 6-to-8 days.

Related: the projection is not "what Home computes". `sinceAnchor` (`:4737-4742`) anchors sleep to `ev.end` and feed to `ev.time + ev.dur`, and `state.events` arrives on its own subcollection listener, not the blob `pushNow` diffs. It is its own computation with its own drift risk against Home.

## 3. The App Group entitlement is a risk to the *main app*, not the widget

`tools/cap_ios_configure.rb:72-89` rewrites `App.entitlements` wholesale; `tools/cap_ios_build.sh:72` hand-signs with that literal file and then relies on `-exportArchive` **preserving** what it finds (header, lines 18-21). The pipeline's load-bearing property is "whatever this file says is what ships" (`cap_ios_configure.rb:58-67`). Add `com.apple.security.application-groups` and, if the distribution profile does not grant it, the export fails and **no iOS build ships at all**.

Worse: the archive is built `CODE_SIGNING_ALLOWED=NO` (`cap_ios_build.sh:57`), so the automatic-signing capability-sync Xcode normally does at build time has never run on this pipeline. Nothing in this repo has ever registered a capability on the portal. `native-build/ExportOptions.plist` is `signingStyle: automatic` with no `provisioningProfiles` map, so the appex profile must be minted during export by `-allowProvisioningUpdates`. Budget portal work and at least one failed export, not a footnote.

## 4. The hand-sign dies before any assertion fires

`codesign --force --sign … "$APP"` at `cap_ios_build.sh:72` on a bundle containing an unsigned `PlugIns/*.appex` is rejected for unsigned nested code, and under `set -euo pipefail` (`:29`) the script dies there with a message about a subcomponent, not about the appex. Inside-out signing is a **new step with its own entitlements file** that `cap_ios_configure.rb` must generate — its heredoc writes exactly one file today — plus its own `--generate-entitlement-der`, plus the extended assertion. The proposal treats this as extending the loop at `:75-88`. It is more than that.

## 5. A tracked Swift directory gets published to little-cubby.com

`wrangler.toml` deploys `[assets] directory="./"` — the whole repo. `.assetsignore` is the only barrier and names `ios` and `android` explicitly. `tools/deploy_exclusion_check.js` hard-codes that list in `INTERNAL[]` and `MUST_404[]` and is gate `deploy-excl` (`tools/gates.js:42`), written because production was serving `.githooks/pre-push` on 2026-09-07. A new tracked Swift dir needs adding to `.assetsignore`, `INTERNAL` and `MUST_404`. None of those three files is in the proposal's change list.

## 6. The Capacitor plugin cannot be committed as described

- `/package.json` is **gitignored** (`.gitignore:28`), along with `/ios/` (`:26`) and `node_modules/`. The proposal lists `package.json` under "files that would change" — that change cannot be committed.
- `ios/App/CapApp-SPM/Package.swift` says `DO NOT MODIFY THIS FILE - managed by Capacitor CLI` and resolves every plugin by `../../../node_modules/<pkg>`. This project is **SPM, not CocoaPods**.
- So a repo-local plugin needs a tracked source dir (also `.assetsignore`d), an untracked `file:` dependency, and an `npm install` step that `cap_ios_configure.rb` does not do and cannot assert — breaking the script's own stated contract that "a fresh machine can reproduce the exact build" (`cap_ios_configure.rb:4-8`).

## 7. No gate can ever see any of this

113 gates in `tools/gates.js`, all run by `.githooks/pre-push` because push = deploy. CI is `ubuntu-latest` (`.github/workflows/gates.yml`) so it will never have Xcode, and `ios/` is gitignored so CI cannot see the project regardless. Every widget assertion is either a string-match over a tracked Swift file or a manual step on one Mac. Against `CLAUDE.md`'s "A test not wired into tools/gates.js does not exist", this is the largest unpriced item in the document: **the widget would be the first part of Cubby with no automated verification, in a repo whose entire safety model is automated verification, and whose native build has already shipped two silent entitlement failures** (builds 1-5, build 9).

## 8. The `src=widget` attribution claim is false

"The deep link carries `src=widget` into the first-party event stream that already exists, and that is all." There is no such stream. `workers/funnel/core.mjs:238-254` has exactly three events (`onboarding.step_reached`, `invite.sheet_opened`, `pro.sheet_viewed`), and `stepKey` (`:259-272`) rejects any event with an extra property (`keys.length !== want.length`) or an unlisted enum value. A widget-sourced event is a new event or enum value, a matching `.telemetry/tracking-plan.yaml` change, and a pass of `tools/tracking_plan_check.js` — which also underwrites the App Store privacy answer. Small, but not free and not existing.

## 9. Where stage 0a is cheaper than claimed, and where it is not

**Cheaper:** the `cubby://` scheme is probably unnecessary. `worker.js:2246` already serves AASA with `{'/': '/app/*'}`, entitlements carry `applinks:little-cubby.com`, and `app/native-bridge.js:163-172` already ingests **both** `appUrlOpen` and `getLaunchUrl` into `routeDeepLink`. The https path exists end to end today.

**Not cheaper:** the latency 0a measures is worse than "seconds, not instant", and is not something a widget can improve. `maybeRunDeepLink` (`app/index.html:2648`) refuses to run while `LL.needsIdentity` or `#llAuthOv` is up, then `setTimeout(…, 350)`; `scheduleDeepLink` polls at 250 ms with a 5-minute blocked budget. The page it waits on is `app/index.html` at **1,501,814 bytes** plus `store-firebase.js` at 232,779, behind an 800 ms splash.

Two smaller things: `runDeepLink` (`:2694-2712`) gates `BABY_GO` on `hasBaby` and `PREG_GO` on `hasPreg`, so the new targets are guarded work not just map entries. And the existing key is `diaper`, not `nappy` — a mismatch between widget copy and URL key, in strings that compile into a binary you cannot recall.

## 10. Two premises to correct

- **"anything clicked in Xcode dies on the next `npx cap sync`"** (inherited from the Live Activities verdict). `cap sync` runs copy+update and rewrites `CapApp-SPM/Package.swift`; it does **not** regenerate `project.pbxproj`. What kills hand-clicked work is `cap add ios` and the fact that `ios/` never leaves this Mac. The conclusion (script it) holds; the mechanism matters because you cannot prove the scripting works by running `cap sync` — you need `rm -rf ios/ && npx cap add ios && npx cap sync ios && ruby tools/cap_ios_configure.rb` and a full archive, on the one machine that can.
- **The `sw.js:96` claim is confirmed false and worse than stated.** `UNNotificationCategory` appears nowhere in the tracked tree except that comment. What exists is `native-bridge.js:239`, a `notificationActionPerformed` listener that routes a *tapped notification's* data into the deep-link router — a tap handler, not an action button. The dose "Log it" button has no iOS implementation at all. Fix the comment.

---

## Re-estimate

| Stage | Proposed | Realistic | Why |
|---|---|---|---|
| 0a | 1-2d | **1-2d** | Probably less; universal links already work. But it measures a number you cannot fix. |
| 0b | 7-9d | **10-14d** | + `.assetsignore` and deploy-exclusion gate, + appex entitlements file, + separate inside-out codesign pass, + the assertion shown red, + a portal round-trip with zero registered devices to test on. Real chance of a multi-day stall on export. |
| 1 | 6-8d | **12-18d** | The plugin cannot be committed as described; the mirror is three hook points; the wipe is four more plus a cross-device path that does not exist; the "ago" copy is an open design question; the entitlement is a shipping risk to the main app. |
| P | +3-4d | **not separable** | Its correctness depends on the cross-device wipe, which is the hardest part of stage 1. |
| 4 | 5-7d | **don't** | Agreed, and for the stated reason. |

One consistency note the document should own: it charges 7-9 days for a target plus four static buttons, while asserting this is the same target `docs/plans/2026-08-21-live-activities-verdict.md` priced at 7-10 days for target + signing + SwiftUI Lock Screen + Dynamic Island + two session types. Both cannot be right. The honest reading is that the Live Activities phase-1 number was low, which makes that plan cheaper on paper than it is.

## What I would add to "would not build"

**Ship the pregnancy widget in the same cycle as the mirror.** The one surface where being wrong is unforgivable is the one whose correctness depends on a cross-device wipe this architecture cannot perform today. Per §1, "week 27 after a loss" on a co-parent's phone is the default, not the edge case.

Everything else on that list — no photos in the container, no mood, no clinical values, no circle-activity widget, no Android, no watchOS, kill stage 4 — I would keep verbatim.