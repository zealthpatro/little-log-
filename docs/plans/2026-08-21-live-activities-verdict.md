# Live Activities for Cubby: the technical answer

**2026-08-21.** The engineering question was "please confirm this approach works from a technical
and Apple guideline perspective." Short answer: **the shape is right, one of the three triggers is
buildable as written, and the half you assumed was easy is the bigger project.**

Grounded in Apple's HIG and App Review Guidelines, Google's Live Update eligibility rules, and this
repo: `capacitor.config.json`, `tools/cap_ios_build.sh`, `tools/cap_ios_configure.rb`, `worker.js`,
and the ritual code in `app/index.html`.

---

## The verdict in one paragraph

Trigger 1 (a parent manually starts a session) is squarely inside Apple's rules and needs no server
work at all. Trigger 2 (auto-start a countdown 10 to 15 minutes before a scheduled ritual) cannot be
built as written and does not need to be, because there is a better path that works on iOS 16.1
today. Trigger 3 (medication time windows) should be inverted, because as drawn it fails Apple's
"ongoing task the person initiated" test, Google disqualifies it by name, and it would be a
**downgrade** on what already ships. Android should be struck from this cycle entirely. Apple Watch
is free. And the rule you drew, recurring rituals get notifications while active ones get a Live
Activity, is correct and is also Apple's own guidance, so it must be enforced per ritual instance
rather than treated as a preference.

---

## Confirmed as written

**The core split.** Recurring or pre-planned gets a notification; starting or active gets a Live
Activity. This is not just defensible, the HIG names the opposite as an anti-pattern: do not pair a
push notification with a Live Activity for the same update. Enforce it as a hard rule per instance,
not a vibe. One alert per ritual instance, and the Live Activity is the consequence of a tap.

**Trigger 1, manual start.** A parent taps Start, the app is in the foreground, `Activity.request`
is allowed. iOS 16.1+. No push, no server, no entitlement beyond the widget target. For feed and
pumping a running clock needs **zero** push updates if the SwiftUI view uses `Text(timerInterval:)`,
so it ticks for free.

**A countdown is fine with Apple.** Their own example is a flight departure. The objection is never
the countdown, it is a countdown appearing unattended for something the parent did not initiate.

**A medication reminder is an acceptable use.** Nothing in the Review Guidelines forbids it, and
1.4.1 (medical apps) does not bite a parent-entered reminder. One caveat below.

**Apple Watch is genuinely free.** iPhone Live Activities render in the watchOS Smart Stack with no
watch app and no extra build. It is a rendering of the iOS work, not a second project.

---

## Amended: three things that need to change before anyone writes Swift

### 1. The 8-hour ceiling breaks the sleep case

A Live Activity gets active updates for at most **8 hours**, then the system force-ends it and it
lingers on the Lock Screen for up to 4 more. A night sleep from 19:30 to 07:00 is about 11.5 hours.
iOS kills it around 03:30 and it then sits on the Lock Screen showing a **frozen, wrong duration**
until roughly 07:30.

The parent that happens to is precisely the one the codebase already describes as too tired to tap
Stop, and Cubby now nudges at 12h and caps the display at 24h for exactly that reason.

**Do instead:** the sleep Live Activity self-ends at about 7h50m with a deliberate final state
("still asleep? open Cubby") rather than letting the system freeze it mid-count. Feed and pumping
are short and unaffected.

### 2. The pre-ritual countdown cannot start itself, and does not need to

Three facts stack up:

- `Activity.request` generally requires the **foreground**. There is no local scheduling API before
  iOS 26.
- Push-to-start needs **iOS 17.2+**, and push is a separate token from the FCM registration tokens
  the Worker already stores.
- The cron ticks every 15 minutes, so a "10 to 15 minutes before" lead is **arithmetically
  impossible**: the countdown would appear anywhere from T-15 to T-0, sometimes as the ritual
  starts. That is not a tuning problem.

**Do instead, and this is the recommendation for v1:** send the plain notification you were going to
send anyway, and start the Live Activity when the parent **taps it**. The tap foregrounds the app,
so `Activity.request` is legal on iOS 16.1 with no push-to-start, no new token, no iOS 17.2 floor.
It also resolves the HIG conflict properly rather than dodging it: there is exactly one alert, and
the Live Activity is a consequence of the parent choosing to engage.

### 3. Invert the medication trigger

As drawn, a vitamin due at 10:00 every day is a standing reminder, which is the notification lane.
It fails Apple's "ongoing task the person initiated" test more clearly than trigger 2 does, Google
disqualifies it by name, and worst of all it is a **downgrade**: the notification Cubby already
ships can write the dose from the Lock Screen, and a Live Activity cannot.

**Do instead:** start the countdown when a dose is **logged**, not when one is due. "Next dose in
3h 42m" has a real beginning (she gave it), a real end (the next one is due), and a user action
behind it. That converts trigger 3 into trigger 1, which is the legal, free, private version.

One copy note either way: keep the drug name off the Lock Screen glass. `app/index.html:5478`
currently puts it there.

---

## Rejected

**Android, for this cycle.** Not scoped down, struck.

- There is **no shippable Android app**. The `android/` project was generated once and abandoned.
- Google's own eligibility rules **disqualify triggers 2 and 3 by name**: an upcoming calendar event
  and a medication window are both given as examples of what a Live Update is not for.
- Real coverage is roughly a **quarter** of Android devices, and within that quarter the treatment is
  effectively Pixel and Samsung only. Three in four Android parents would see a plain notification.
- The floor is **Android 16 QPR1**, not Android 16.0. A spec that says "Android 16" will pass QA on a
  device that renders a plain notification. Gate on `NotificationManager.canPostPromotedNotifications()`.
- No Capacitor plugin exists, official or community.

Listing Android beside iOS implies a parity that does not exist and roughly doubles the work.

**Complete and Pause buttons, in v1.** This is the deepest architectural problem in the proposal.
An AppIntent button runs **Swift in the widget extension's process**, while every piece of Cubby's
logic and data lives in a remote-loaded WKWebView pointing at little-cubby.com/app/. A tap on
Complete cannot call `stopSleep()`. Making it work means either duplicating Firebase Auth and a
Firestore write in Swift, or writing an intent record into a shared App Group container for the web
layer to drain on next open.

**Ship v1 with no buttons.** Tapping the card opens Cubby and the web layer does the write. Honest,
still useful, and it removes the App Group entitlement and a second entitlements heredoc from the
build script.

---

## The part that is actually the big one

**The half you called simple, "pre-planned rituals use normal notifications", is the larger project,
and building it naively would break medicine reminders.**

Today a ritual is a checkbox with a time hint. It has no recurrence field, no notify flag, no
session, and ticking it writes an already-completed event. Both sides of your line are empty.

Specific things that must be fixed first, all in `worker.js` and the ritual code:

1. **No recurrence model.** A daily walk is expressible (that is the default). "Massage on Tuesdays
   and Thursdays" is not. Each ritual needs `days:[0-6]` and `notify:false`, on a field that lives
   in the shared household blob.
2. **The queue has one cursor.** A ritual entry whose fire time falls below a cursor already advanced
   by a medicine reminder is **dropped permanently**. Rituals need their own cursor.
3. **The queue has 60 slots and one category.** Five rituals a day across a week is 35 entries
   competing with medicine. Extending the horizon to a week pushes medicine off the end.
4. **Riding rituals on `cat:'critical'`** makes bath time uncapped and puts it behind the same toggle
   as dose alerts, so turning off bath nudges turns off medicine nudges.
5. **Quiet hours silently delete the commonest ritual.** Morning feed at 07:00 with any lead fires at
   06:45 or 06:30, inside quiet hours, and is dropped with no trace. Every ritual in the Night band
   the editor now invites parents to fill has the same problem.
6. **`assignee` cannot be delivered to.** The queue is per-user and self-authored and the rules
   forbid writing to another member's document, so "Papa does the evening walk" cannot become a
   reminder to Papa.
7. **There is no cancel path.** A ritual ticked at 18:10 still buzzes at 18:15, on every phone,
   because `toggleRoutine` never refreshes the index. The medicine path already solved this.
8. **Two live promises forbid it.** Settings currently promises nudges for rituals while the app says
   two thousand lines away that rituals notify nothing, and the reminders sheet promises "never for
   feeds, naps or milestones". The seeded ritual list is made of exactly those things. This is a copy
   decision before it is a code decision.

---

## Suggested sequence

| phase | scope | rough effort |
|---|---|---|
| 0 | Fix the ritual reminder foundations: recurrence, own cursor, own category and toggle, quiet-hours handling, a cancel path on tick, and the Settings copy | days, not hours |
| 1 | Live Activity for a manually started feed or pumping timer. iOS only, no buttons, no push, `Text(timerInterval:)` | the smallest real slice |
| 2 | Sleep, with the 7h50m self-end and its deliberate final state | small, once phase 1 exists |
| 3 | Notification-tap starts the ritual Live Activity. Still no push-to-start | needs phase 0 |
| 4 | Dose-logged countdown, the inverted trigger 3 | small |
| 5 | Reconsider push-to-start, multi-caregiver sync, and buttons | only if 1 to 4 earn it |

Build-system work that phase 1 cannot skip, because `ios/` is gitignored and regenerated on every
build: the Widget Extension target has to be created **programmatically** in `cap_ios_configure.rb`
via Xcodeproj, `NSSupportsLiveActivities` added through the existing PlistBuddy block, and
`cap_ios_build.sh` taught to sign the `.appex` inside-out with its own entitlements before the outer
app. Anything clicked by hand in Xcode is lost on the next `npx cap sync`. That script is also the
one that shipped `aps-environment=development` for months, so extend its guard in the same commit.

---

## The reply to send

> Thanks, this is close and the core call is right.
>
> The split you drew, recurring rituals get notifications and only a starting or active one gets a
> Live Activity, is correct and it is also Apple's own guidance. They name the opposite as an
> anti-pattern, so we should enforce it as a hard rule per ritual instance.
>
> Trigger 1, a parent manually starting a session, is confirmed and needs no server work. Two notes.
> Sleep has to self-end at about 7h50m, because iOS force-ends a Live Activity at 8 hours and then
> leaves it frozen on the Lock Screen for four more, and a night sleep is 11 hours. And pumping and
> rituals are not sessions in Cubby yet, so those are new timers before they are Live Activities.
>
> Trigger 2 cannot auto-start as written. There is no local scheduling API, starting one otherwise
> needs push-to-start on iOS 17.2+, and our cron ticks every 15 minutes so a 10 to 15 minute lead
> would land anywhere from 15 minutes early to exactly on time. Better and simpler: send the normal
> notification, and start the Live Activity when the parent taps it. That works on iOS 16.1 today,
> needs no push-to-start, and gives us exactly one alert per ritual, which is what Apple wants.
>
> Trigger 3 we should invert. A vitamin due at 10:00 is a standing reminder, which is the
> notification lane, and Google disqualifies it by name. It is also a downgrade for us: our current
> dose notification can log the dose from the Lock Screen and a Live Activity cannot. Instead start
> a countdown when a dose is logged. "Next dose in 3h 42m" has a real beginning and end and a user
> action behind it, which makes it trigger 1.
>
> Please drop Android from this cycle. We have no shippable Android app, Live Updates reach about a
> quarter of devices and in practice only Pixel and Samsung, the real floor is Android 16 QPR1 rather
> than 16.0, there is no Capacitor plugin, and Google's eligibility rules rule out two of our three
> triggers anyway. Apple Watch is the opposite: iPhone Live Activities appear in the Smart Stack for
> free, no watch app needed.
>
> On Complete and Pause: leave the buttons out of v1. Those run Swift in the widget extension, and
> all of Cubby's logic lives in the web app we load remotely, so the button cannot reach the data
> without duplicating auth and writes in Swift. Tapping the card to open Cubby is honest and still
> useful.
>
> Last thing, and it is the one that will surprise us: the notification half is the bigger project,
> not the Live Activity half. Rituals have no recurrence, no notify flag and no off switch today,
> the reminder queue has a single cursor and 60 slots shared with medicine, quiet hours would
> silently drop a 07:00 morning feed reminder, a ritual ticked early still fires, and we cannot
> deliver a reminder to the person a ritual is assigned to because the queue is per-user. All of
> that has to be right before rituals notify anything, or ritual reminders will start eating
> medicine reminders.
