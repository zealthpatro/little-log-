# Glass surfaces audit: widgets, lock screen, StandBy, nudges, Live Activities

19 November 2026. Read-only audit of worktree `android-feature-sync-strategy-33e94c` at a7fadfd4 (sw CACHE
little-log-v371). Nothing was edited except this file. Founder decisions D1-D8, C1-C7 and F1-F12 are fixed: where
something disagrees with one, it is reported, never reopened.

"Glass" means anything Cubby puts on a screen without the app open: home-screen widgets (medium, small, twins), the
lock-screen widgets (rectangular and inline), StandBy, iPhone widgets on a Mac or the iPad lock screen, notifications
(server push, the page's own notification, the "Log it" confirmation, campaigns), calendar alarms Cubby writes, and a
future Live Activity with its Dynamic Island.

Sources: the four inventories and three lenses in this session's scratch folder (notifications, widgets, Live
Activities, Mobbin; consistency, UX, privacy), re-checked against the tree tonight. Short tags: I = app/index.html,
SW = app/sw.js, W = worker.js, SF = app/store-firebase.js, J = docs/widgets/widget-copy.json, S = the widgets spec
(docs/superpowers/specs/2026-11-16-home-screen-widgets-design.md), P0 to P6 = docs/superpowers/plans/2026-11-17-widgets-*.md
(P1 T10 = plan 1, Task 10; S line numbers are as of a7fadfd4, about seven lines later than the inventories'
because F12 was added), B16 to B22 = the Suite canvas boards, S08 = the 6 Oct Live Activity board.

Since the inventories were written, the reference model and 90 golden fixtures landed (f15a37af, a32ae71c, cbbcb0c7,
a7fadfd4). They settle the small widget on a month day, one twin's month day ("Wren · 3 months today"), the twins
spoken form ("Robin is 1 month old today and Wren is 1 month old today"), the 20-hour day words, stale buttons, the
small long nap, small set to Both (F12), lock signed-out ("Cubby"), and the lock line with no sleep logged (the line
is left out, no more "woke not logged"). Those are not repeated as findings.

## 1. Verdict

1. The widgets are close to best in class for a 3am reader: the clock time is the fact, nothing counts, no medicine, illness or author on locked glass, honest failure lines, and every state is now pinned in one copy file with fixtures.
2. The notification lane is not. It was never brought under the widget rules: it names the medicine today, can tell a parent "Dose logged" for a dose her partner already gave, drops evening doses inside fixed quiet hours, and ignores loss holding.
3. Glass speaks three vocabularies for one fact (widget, in-app, the 6 Oct Live Activity board): five phrasings for a running nap, four for the stop button, three for a failed save, three for the undo window.
4. What most needs to change: put every notification, calendar alarm and Live Activity string into widget-copy.json under the same parity gate, and fix the two dose-safety bugs (G-01, G-02) inside P1 Task 10 before it ships C6.
5. Live Activities should stay out of this update, but their contract belongs in the copy file now, so whatever is built later inherits the rules below instead of the 6 Oct board.

## 2. The glass rulebook

Each rule ends with how a gate checks it. "PG" is tools/widget_parity_check.js run over widget-copy.json; "model" is
tools/widget_model.js with its fixtures; "emu" is a Firestore emulator test. Rules marked (Qn) depend on a founder
answer in section 5; the rule states the recommended answer.

### A. Who may see what (privacy tiers)

R1. Tier 1, the home screen (medium, small, twins, on an unlocked phone): the baby's first name, feed, sleep and nappy
clock times with their "ago" line, who logged it (F7), the month day (F10), and the Health button while a baby is
unwell (D4). Never a medicine, dose, temperature, illness name, mood, note, photo or pregnancy (F4 holds the kind).
Check: PG fails any `home` or `small` string with a `{med}`, `{dose}`, `{temp}` or `{week}` placeholder; model
fixtures assert the snapshot has no such field.

R2. Tier 2, anything readable while locked or away from the home screen: lock rectangular and inline, StandBy, iPhone
widgets on a Mac, the iPad lock screen, a Live Activity, the Dynamic Island and the watch Smart Stack. Only the baby's
first name beside feed and sleep clock times. Never the logger, the month day, the Health swap, a medicine, an illness
sign, a pregnancy, or a button (the one exception is a Live Activity's "Stop sleep", Q1, which needs an unlocked
device). One off-home list for every home-only extra: StandBy, Mac, iPad lock screen (P3:598), whatever the spec's F7
and F10 sentences each list.
Check: model takes a `location` input (home, lock, standby, mac); fixtures for each assert no `by`, no `moment`, no
Health and no buttons off home. Today those rules live only in Swift (P3 T6 `testPrivacyTable`).

R3. Tier 3, notifications of every kind (push, the page's own "Medicine due", the "Log it" confirmation, campaigns):
no baby name, no medicine, no dose amount, no illness name, no pregnancy, week or loss word. A dose notification may
say "medicine", "dose" and a time, nothing more. The ticket payload carries ids, never the medicine name (`mn` leaves
the ticket; /api/dose resolves the name from `medId`).
Check: dose-push-copy gate (P1 T10) extended to the page notification and the ticket; PG fails any `push` string with a
`{name}`, `{med}` or `{dose}` placeholder; a staged "Time for {med}" must turn it red.

R4. Tier 3b, files she adds to her own calendar: may name the baby and the appointment, because she chose to add them,
but never a medicine (Q2: the name moves to the event notes), never an alarm between 9:00 PM and 7:00 AM unless she
set that time, and pregnancy items are bounded with COUNT. Each export sheet says once, before the button: "These
alerts show on your lock screen, and on any device that shares this calendar."
Check: an ICS gate parses every export, asserts each VALARM lands at 9:00 AM local or at her chosen time, and that no
dose SUMMARY or alarm text contains the medicine name.

R5. Tier 4, silent pushes (the widget refresh poke): no `notification`, `alert`, `sound` or `badge` at any depth and no
family data, only `cubby: 'widget-refresh'`.
Check: the planned `widget-poke-payload` gate (P5 T3).

### B. One phrasing for each shared fact

R6. Every shared fact has exactly one form, and every surface that shows it uses that form:

| Fact | Two-line slot | One-line slot | Notification | Never |
|---|---|---|---|---|
| Last feed | "Last feed" / "2:10 AM" / "1 hr, 5 min ago" | "Last feed 2:10 AM"; "Robin · last feed" | none | "Last fed", a countdown to the next feed |
| Woke | "Last sleep" / "1:20 AM" | "Robin · woke 1:20 AM" | none | "slept for" |
| Sleep running | "Sleep" / "Asleep now" ("Asleep" when narrow) / "since 2:40 AM" | "Robin · asleep since 2:40 AM"; twins row "Asleep since" / "2:40 AM" | none | "Sleeping", "Napping", "started", a ticking count |
| Long sleep | home screen only: "Still asleep?" and "Stop sleep" with the arrow | "Robin · asleep since 7:10 PM" | none | "Did it end earlier?", any "?" on Tier 2 or 3 |
| Start and stop | "Start sleep", "Stop sleep", "Start both", "Stop both" | small: moon with "Start" or "Stop" | n/a | a play or stop glyph, bare "Stop" beside a name, "Complete", "Nap" |
| Nappy | "Last nappy" | n/a | none | "Diaper" |
| Dose due | none on widgets (C7) | none | "Medicine due soon" / "A dose is due within half an hour." | the medicine, the dose, the baby, "Time for", "overdue" |
| Dose digest | none | none | "Medicines today" / "Your list for today is in Cubby." | names |
| Dose logged | n/a | n/a | "Dose logged" / "Logged at 2:05 AM. Tap to see or change it." | the medicine name |
| Dose already given | n/a | n/a | "Already logged" / "A dose went on the record at 1:55 PM." | "Dose logged" for a dose someone else gave |
| Unwell | "Health" with the arrow, quiet note colour, no thermometer | never | never | an illness name or a temperature on glass |
| Month day | "3 months today", "1 year today", "2 years today" (honey ink, star) | never | never | "12 months" where the widget says "1 year" |
| Who logged | "Last feed · Dad" (home screen only, not on twins rows, F12) | never | never | the viewer's own name, an email |
| Empty | "not logged" | "Last feed not logged"; the sleep line is left out | n/a | "not yet", "--", a zero |
| Freshness | "Updated 3:14 AM" | the clock alone once the snapshot is old (R11) | n/a | "updated 4m ago" |
| Stale | `fallback.stale` ("Open Cubby to catch up.") | same; inline reads "Cubby" | n/a | a number older than 6 hours |
| Offline | "No connection, so that didn't save." | n/a | same title, body "Open Cubby to log it." | "You look offline" |
| Failure | "That didn't save. Open Cubby to log it." | n/a | same | "Could not", "so nothing is missed", "Tap to try again" |
| Already | "Already started in Cubby.", "Already stopped in Cubby." | n/a | see "Dose already given" | |
| Unknown | "Checking" (dimmed) | n/a | n/a | "Saving" |
| Undo | "Undo", 10 seconds | n/a | n/a | "10 minutes", "the same as the widget" for anything longer |
| Hidden | "Cubby" | "Cubby" | "Cubby" / "You have a reminder." (Q5) | |
| Signed out | "Cubby" / "Open Cubby to sign in." | "Cubby" | nothing (no token left, R18) | |

Check: every cell above is one key in J; the dose and failure rows move into J (they are literals in sw.js, I and W
today); PG asserts each key is used by every surface listed and that no literal copy of it exists elsewhere
(`grep` for the strings outside the generated files must find none).

R7. In-app words for the same fact match glass where the app shows the same thing: Home's empty cell says "not
logged", the running nap says "Asleep now" / "since 2:40 AM", the long-nap ask says "Still asleep?", the banner's
button says "Stop sleep" (Q6). The app may keep what glass cannot have (the ticking banner, longer undo, retries).
Check: a since-card test reads Home's rendered text against the J keys.

### C. Time

R8. Every clock time is fmtClock: "2:10 AM", in widgets, notifications, ICS text and the Reminders sheet ("9:00 PM",
never "21:00" or "3:00pm"). Strings take the formatted time as a parameter; none builds a clock by hand.
Check: PG and a source grep fail `'pm'`, `'am'` lowercase suffixes and `:00 and` 24-hour text in customer strings.

R9. The relative line is the system's on iOS ("1 hr, 5 min ago", the accepted C1 difference), absent on Android, never
in seconds, never a frozen string. Past 20 hours it becomes "Yesterday", "Mon" or "14 Oct", and "Updated" follows
("Updated yesterday 11:50 PM").
Check: model fixtures `day-*`, `updated-yesterday` (exist).

R10. No ticking count on any glass surface, the Live Activity and Dynamic Island included (C2's rule, extended; Q1).
No countdown to a next feed, nap or dose anywhere on glass.
Check: PG fails any `activity` key that takes a duration parameter; the Swift and Kotlin views may not use
`Text(timerInterval:)` or Chronometer (a source grep in the native gates).

### D. Freshness

R11. Every widget surface says how old it is (S goal G4). Medium, small and StandBy carry "Updated 3:14 AM". The lock
rectangular drops its live "ago" line once the snapshot is older than one pull period (J `pullEveryMs`) and shows the
clock alone. Past 6 hours every surface shows `fallback.stale`, and the inline lock reads "Cubby".
Check: new fixtures `lock-rect-old` (no `agoAt` after one pull period) and `standby-updated` (fresh row present).

### E. Tone

R12. Sentence case; a capital opens a line, lower case follows " · " unless a proper noun. Second person where a
person is addressed. No em-dash, no exclamation mark, no emoji in any glass string. No question mark on Tier 2 or 3;
the one question on glass is the home screen's "Still asleep?" (F11).
Check: PG (exists for widget strings); extend to `push`, `calendar`, `activity`; add the " · " lower-case rule.

R13. Banned on glass: J's list ("don't forget", "last chance", "time for", "streak", "goal", "total", "Pro") plus
"so nothing is missed", "overdue", "You look offline", "Could not".
One apostrophe form across all glass strings (recommend ’, as the app's own copy uses).
Check: PG banned list and an apostrophe assertion; a staged "Time for" in a `push` key must go red.

### F. Quiet hours and caps

R14. Quiet hours are per device, default 9:00 PM to 7:00 AM, and she can change them. Inside them Cubby's pipe shows
nothing: campaigns wait (cap not spent), the digest is skipped, and a heads-up whose dose falls after quiet hours is
sent at the end of quiet hours instead of being dropped. The test is the dose time, not the fire time, and the Worker
re-checks it with the stored time zone. A medicine with doctor-set times reminds at its time even inside quiet hours,
quietly: no sound, not time-sensitive (Q4). The Reminders sheet says what each channel does, in one sentence.
Check: an emu test with doses at 7:15 AM, 10:00 PM and 2:00 AM asserts send, send at 7:00 AM, and quiet send or
none per Q4; a Worker test with a stale client queue at 3:00 AM asserts no send.

R15. Caps. One banner per dose (collapse by tag). A digest only on a day with two or more medicines due. Feature
nudges at most 5 a month and marketing 2 a month (W:1441), at most one campaign a day, never in the same tick as a
dose reminder. Time-sensitive only for a dose at its own time, never for a 30-minute heads-up.
Check: Worker unit test over a staged tick with a dose and a campaign due together.

### G. Actions and taps

R16. Glass may write exactly two things. Start and stop sleep, from a home-screen widget, on an unlocked device,
through POST /api/widget/nap (D6). "Log it" on a dose notification, only when exactly one reminded medicine is due for
that child in that window, behind Face ID or unlock, never on a desktop browser (Q3). Every write answers in R6's word
set: dim while pending, "Checking", the new state, "Undo" for 10 seconds, "Already ...", offline, failure. Nothing is
queued (C3). The control stays where it was across states. Every button that opens Cubby carries the arrow; the
in-place button is solid.
Check: model fixtures `b-*` (exist); the dose route test stages two due medicines and asserts no ticket.

R17. A tap lands where the fact lives: the body opens Home on that baby, a button its sheet, a month day the month
card, a failure line the sheet that redoes it, and a dose notification that medicine for that baby (`data.medId`).
No glass surface opens a screen that does not show what it just showed.
Check: widget-deeplink gate (P1 T7) gains `go=medicine&med=&baby=`; an SW click test asserts the URL.

### H. "Hide details" and the end of access

R18. One per-person switch, `lockScreen.hide` (mirrored to `users/{uid}.widget.lockHide`). When on: every Tier 2
surface reads "Cubby" and nothing else; the home screen keeps its details; notifications read "Cubby" / "You have a
reminder." (Q5); a Live Activity reads "Cubby". Its label names every place it covers, and it is shown wherever a
covered surface is active for that person (a widget installed, or reminders on).
Check: model fixture per location with `hide: true`; dose-push-copy gate gains a `lockHide` case and its mutant.

R19. Loss holding. With no living child every widget is the wordmark; with one, that child's times and Sleep button
stay, with no month day and nothing pregnancy-related, long-press shortcuts included (F3, F10). No campaign reaches a
person in holding (the Worker reads the household's `lossHolding` as P5's `pullLossHolding` does). Dose reminders
continue only for a living child's medicines. The loss screen offers one card to take back every calendar file Cubby
gave her for that pregnancy or baby. A Live Activity ends at once.
Check: model fixtures `quiet` (exists); a Worker campaign test with holding set asserts deferral; an emu test asserts
no reminder for a medicine whose baby is gone.

R20. Sign-out, removal and account switch end glass at once: this device's push token is deleted before
`auth.signOut()`, the page stops raising its own notifications, widgets fall to the wordmark (a 401 on the pull
writes the wordmark state), shortcuts are cleared, a Live Activity ends.
Check: puppeteer sign-out test asserts the token key is gone and no `Notification` is constructed after a due dose;
P5 T8's 401 test asserts the wordmark.

### I. One source

R21. Every glass string lives in widget-copy.json with a surface tag from: home, small, lock, standby, gallery, a11y,
line, config, app, push, calendar, activity. tools/widget_gen.js generates the Worker, sw.js and index.html copies as
it already does for Swift and Kotlin. Platform differences are declared keys, never silent.
Check: PG's surface list (today eight, none a notification) grows to these; a source grep fails any customer glass
string that is not generated.

## 3. Surface by surface, moment by moment

Each cell is the target wording from the rulebook. Where the tree or a board says something else today, the cell says
"Today:" and points at the finding. Times follow the fixtures (Robin, last feed 2:10 AM, Dad logged it). "Mac" means
iPhone widgets on a Mac, which follow StandBy.

| Moment | Home screen (medium; small) | Lock screen (rectangular; inline) | StandBy, Mac, iPad lock | Notification | Live Activity (if built, Q1) |
|---|---|---|---|---|---|
| Everyday | Medium: "Robin" / "2 months old" / "Updated 3:14 AM"; "Last feed · Dad" "2:10 AM" "1 hr, 5 min ago"; "Last sleep" "1:20 AM"; "Last nappy" "1:40 AM"; Feed, Sleep (Phase A, arrow) or Start sleep (Phase B), Nappy, Activity. Small: "Robin · last feed" / "2:10 AM" / "1 hr, 5 min ago · Dad" / "Updated 3:14 AM"; moon "Start", Feed | "Last feed 2:10 AM" / "1 hr, 5 min ago" / "Robin · woke 1:20 AM"; inline "Last feed 2:10 AM" | Small enlarged: "Robin · last feed" / "2:10 AM" / "1 hr, 5 min ago" / "Updated 3:14 AM"; no buttons, no "· Dad". Today: the board drops "Updated" (G-08) | Nothing. Feeds, sleeps and nappies never notify | None |
| Sleep running | Medium: "Sleep" / "Asleep now" / "since 2:40 AM"; "Stop sleep" solid. Twins row "Asleep since" / "2:14 AM". Small: moon "Stop" solid | "Robin · asleep since 2:40 AM"; inline unchanged | No sleep line (the small widget has none, and its buttons are hidden) | Nothing | "Robin · Asleep now" / "since 2:40 AM"; island: moon with "2:40". Today S08: "Robin · Sleeping" / "47:12" / "started 1:20 AM" / "Stop" (G-20) |
| Long sleep, 12h+ | Medium: header "Still asleep?"; "Asleep now" / "since 7:10 PM"; "Stop sleep" with the arrow opens the fix sheet. Small: "Stop" with the arrow | "Robin · asleep since 7:10 PM", no question | as everyday | Nothing | Ended at about 7h50m: "Robin · asleep since 7:10 PM" / `fallback.stale`. Today LAV: "still asleep? open Cubby" (G-20) |
| Dose due | Nothing (C7: Medicine opens Cubby) | Nothing | Nothing | "Medicine due soon" / "A dose is due within half an hour."; "Log it" only if one medicine is due (Q3). Digest "Medicines today" / "Your list for today is in Cubby." Page alert "Medicine due" / "A dose is due now." Today: "Calpol soon" / "Time for Calpol 5ml at 3:00pm"; "Today with Robin" / "Medicines today: Calpol, Ibuprofen"; page "Robin · Calpol · 5 ml is due" (G-06) | Never a dose countdown |
| Dose logged from glass | n/a | n/a | n/a | "Dose logged" / "Logged at 2:05 AM. Tap to see or change it." Already given: "Already logged" / "A dose went on the record at 1:55 PM." Today: "Dose logged" / "Calpol is on the record." even when the partner gave it (G-01) | n/a |
| Unwell | Medium: fourth button "Health" with the arrow, quiet colour. Small: second button "Health" unless already picked | Nothing changes | No buttons in StandBy. Mac: the parent's pick, not Health (G-21) | Only dose reminders, as above | Never |
| Month day | Medium: "★ 3 months today" in the age slot; twins "Robin and Wren · 3 months today"; one twin "Wren · 3 months today". Small: "Robin · 3 months today", "last feed · Dad" under the time | Never | StandBy (small): its ordinary lines, no star. Mac, iPad lock (medium): the age, no star, "3 months old". Today: "2 months old" on most month days (G-10) | Never. In-app pill "Robin is 3 months old 🎉". Today: "Robin is 3 months 🎉" | Never |
| Stale, over 6h | "Updated 8:14 PM"; "Open Cubby to catch up."; buttons stay, Sleep opens Cubby | "Open Cubby to catch up."; inline "Cubby". Between 1h and 6h: clock without the live ago (G-08) | "Updated 8:14 PM" / "Open Cubby to catch up." | n/a | Clock steps aside; `fallback.stale` |
| A tap that failed | "No connection, so that didn't save." / "That didn't save. Open Cubby to log it." / "Already started in Cubby." / "Checking" | n/a | n/a | Same words. Today: "Could not log that dose" / "Open Cubby and log it there, so nothing is missed."; "You look offline. Open Cubby and log it there." (G-11) | Same words |
| Loss holding | No living child: "Cubby". With one: that child's times and Sleep, no month day | "Cubby", or the living child's times | same rule | No campaigns; dose reminders for a living child only. Today: campaigns still arrive; week markers "Week 24 · about the size of a ..." keep coming until she takes them back (G-05) | Ended at once |
| Details hidden | Details stay | "Cubby" | "Cubby" | "Cubby" / "You have a reminder." (Q5). Today: unchanged by the switch (G-09) | "Cubby" |
| Signed out or removed | "Cubby" / "Open Cubby to sign in."; removed: "Cubby" after the next pull | "Cubby" | "Cubby" | Nothing. Today on web: the token stays and the open page still says "Medicine due" (G-04) | Ended at once |

## 4. Findings, ranked by severity and reach

Severity: S1 can cause a wrong or missed dose, reach a parent after a loss, or show one family's details to someone
else. S2 breaks a fixed decision, the Anxiety Test or consistency on glass she sees every night. S3 friction, drift or
accessibility. S4 polish. Reach: All, Many, Some, Few.

| # | Sev | Reach | Surfaces | In one line | Owner |
|---|---|---|---|---|---|
| G-01 | S1 | Many | push | A partner's dose leaves the other phone's reminder live, then "Dose logged" for a dose she did not log | P1 T10 (sw.js) + new change (Worker check) |
| G-02 | S1 | Many | push | "Log it" writes an unnamed dose at now, with no unlock, no undo and two medicines possible | Founder step P1:672 (Q3), then P1 T10 + iOS shell |
| G-03 | S1 | Many | push | Fixed quiet hours drop the evening dose; tested on fire time; no setter; Worker never re-checks | New change + Q4 |
| G-04 | S1 | Some | push, page | Sign-out keeps this device's push token, and an open page keeps raising "Medicine due" after sign-out or removal | New change |
| G-05 | S1 | Few | push, calendar, shortcuts | Loss holding: campaigns, week markers and antenatal alerts keep arriving | New change (reuse P5 T1) |
| G-06 | S2 | All | push, page, calendar | C6 is not built, and is planned for push only | P1 T10 + Q2 |
| G-07 | S2 | All | every notification, LA, StandBy | The copy gate cannot see notifications, Live Activities or StandBy | P1 T4 gate + P1 T10 |
| G-08 | S2 | All | lock, StandBy | A stale number that looks live: no freshness cue until 6 hours | P1 T5 model + P3 T6 |
| G-09 | S2 | All who hide | settings, lock, StandBy, push | "Hide details on the lock screen" covers more widgets than it says and no notifications | Q5, then P1 T4, T9, T10 |
| G-10 | S2 | All, monthly | home, Mac, in-app | "3 months today" on the phone, "2 months old" on Home and on the Mac the same day | New change (ageString, ageOf) |
| G-11 | S2 | All | in-app, push, LA board | One fact, several vocabularies | P1 T10 (sw.js) + Q6 (in-app) |
| G-12 | S2 | All small users | small widget | Plans still draw a play or stop glyph, against F11's moon | P4 T10, P6 T7 and T8, spec |
| G-13 | S2 | Some | calendar | Vaccine alarm fires at midnight two days before, naming the baby | New change |
| G-14 | S2 | All push users | push | Feature nudges default on, bundled with a medicine opt-in, with no copy or stage check | New change + founder yes |
| G-15 | S3 | Some | widgets | A removed caregiver's widget keeps the baby; a stale widget keeps Health past 14 days | P5 T8, P6 T10, P1 T8 |
| G-16 | S3 | Many | push | The dose notification opens Home, where the dose is not shown yet | P1 T7 + P1 T10 |
| G-17 | S3 | Some | push | A daily digest that repeats one daily vitamin; titled with the active baby only | P1 T10 (copy) + new change |
| G-18 | S3 | All new | permission | The OS prompt fires from Save with no preview of the nudge | New change (mockup first) |
| G-19 | S3 | Some | widgets, lock | VoiceOver and large-text gaps | P1 T5 + P3 T6, T9 |
| G-20 | S3 now | Future | LA, island | The 6 Oct board contradicts the glass vocabulary in six places | Q1 + reserved J keys |
| G-21 | S3 | All iOS | StandBy, Mac, iPad | The off-home fence is unproven on a device and absent from the model; Health shows on a Mac | P3 T9 + P1 T5 + spec |
| G-22 | S3 | Some | push | "On for this device" is on for every device, and Off removes all of them | New change |
| G-23 | S3 | Some | calendar | Export sheets never say alerts show on the lock screen; week markers are unbounded | New change |
| G-24 | S3 | All | spec, boards | Spec body and boards still carry the pre-F11 words | Doc pass, P3 T9 SPEC note |
| G-25 | S3 | All iOS | in-app card | Intro card copy lives on a board only; "Not now" means never | P1 T4 + P3 web task |
| G-26 | S3 | Android | push | No notification channel and no lock-screen visibility set | New change with P6 |
| G-27 | S4 | All push | push, in-app | Time-sensitive on a heads-up, sound never decided, "⏰", "3:00pm", "21:00" | P1 T10 + new change |
| G-28 | S4 | All | widgets, push | Three icon languages; Health would draw a thermometer; full-colour badge | P3 T2, T6, P6 T8 |
| G-29 | S4 | Some | widgets | Small notes: running feed invisible, "catch up" tone, lock with no sleep loses the name | Builder notes |

### G-01 (S1, Many). A partner gave the dose; the other phone still nudges, then says "Dose logged"

- Surfaces: dose push, its confirmation.
- Now: each phone writes its own reminder queue and refreshes it only when it persists (throttled to 10 minutes) or
  logs a dose itself (I:8199, I:14996). The Worker sends the queue without asking whether the dose was given since
  (W:1862-1912). If she taps "Log it", /api/dose finds the partner's dose and answers `{ ok: true, already: true, at }`
  (W:3378); sw.js reads only `r.ok` and shows "Dose logged" / "Calpol is on the record." (SW:131-132). P1 T10 keeps
  this shape ("It's on the record.").
- Why it matters: the exact "did I already?" loop the charter names, now with a medicine, and a second dose recorded
  as a calm success.
- Fix: (a) before sending a pre-dose reminder, the Worker runs the dose route's own "given within one interval" test
  (`_medIntervalMs`, `fsRecentEvents`) and drops the reminder; (b) sw.js and the iOS CUBBY_DOSE handler treat
  `already` as its own state: "Already logged" / "A dose went on the record at 1:55 PM." Prove (a) on the emulator,
  never only a stubbed fetch (ways-of-working).
- Owner: (b) P1 T10, which already edits sw.js:126-142 and tests the confirmation in its Section 3; (a) a new change in
  `sendPushReminders`, same sitting as T10; the iOS handler is in the native shell, not in this tree.

### G-02 (S1, Many). "Log it" on an unnamed reminder

- Surfaces: dose push on iOS, Chromium and desktop browsers.
- Now: T10 keeps "Log it" with "It's on the record." (P1:672 founder step open). The route writes the dose at now
  (W:3383-3395), 15 to 30 minutes before it is due. No undo on glass. With two medicines due near 2 AM she cannot tell
  which one she is logging. The iOS action is planned without authentication (DOSE:168-172); Chromium shows the
  button wherever the notification shows, a shared family Mac included (SW:115-116).
- Fix: offer the ticket only when exactly one reminded medicine is due for that child in that window; otherwise no
  button and the tap opens that medicine. iOS registers the action with `.authenticationRequired` (S08 drew Face ID).
  No action on desktop browsers. Confirmation: "Dose logged" / "Logged at 2:05 AM. Tap to see or change it.", opening
  the dose in Cubby where edit and delete exist.
- Owner: founder (Q3), then P1 T10 (Worker ticket rule, sw.js), the iOS shell for the action option.

### G-03 (S1, Many). Quiet hours silence the dose she most needs

- Surfaces: dose push, digest, the Reminders sheet.
- Now: 21 to 7 is the default (I:8009) and nothing in the app changes it. The filter drops any entry whose fire time is
  inside quiet hours: `due=due.filter(function(e){ return !_q(e.at); })` (I:8251). A 10 PM dose (fires 9:30 PM), a 7:15
  AM dose (fires 6:45 AM) and a midnight dose never push; a 9 PM dose does. The Worker re-checks quiet hours for
  campaigns only (W:1598-1599). The sheet promises "Quiet hours: no notification between 21:00 and 7:00. A dose due in
  those hours still shows inside the app, with a softer buzz, because we would rather you saw it than slept through
  it." (I:8102), true only while Cubby is open. Her own calendar export of the same course rings at 2 AM (I:10264).
- Fix: R14. Time chips on the Reminders sheet; test the dose time; send a heads-up at the end of quiet hours rather
  than drop it; the Worker re-checks with the stored time zone; set-time medicines remind quietly at night if Q4 is yes;
  the sheet says what happens in fmtClock words.
- Owner: a new change outside the widget plans (index.html syncReminderIndex and the sheet, worker.js), with Q4.

### G-04 (S1, Some, live on web today). Glass outlives sign-out

- Surfaces: dose push and campaigns on a shared Mac, iPad or handed-on phone; the page's own notification.
- Now: `LL.signOut` runs `teardown()` then `auth.signOut()` (SF:965-969) with no push step; only `disablePush` deletes
  tokens (I:8176-8193), and the cron sends to every token on the user doc. An open tab keeps running
  `checkMedReminders` on a tick that is never cleared, and teardown leaves `state.meds` and `state.babies`, so
  "Medicine due" / "Robin · Amoxicillin · 5 ml is due" (I:15066-15070) keeps appearing for a removed caregiver or the
  next person at the desk. Found by reading; needs a red run before anyone trusts it.
- Fix: R20. Sign-out deletes this device's token first; teardown and the access-lost overlay clear meds, babies and
  events; `checkMedReminders` returns unless a signed-in member's household is live.
- Owner: new change (SF teardown, I). The push range touches store-firebase.js, so pre-push runs the emulator tier.

### G-05 (S1, Few, the worst moment). Loss holding: glass keeps speaking

- Surfaces: campaigns, pregnancy-week and antenatal calendar alerts, vaccine and visit alerts, long-press shortcuts
  on a board.
- Now: `deliverCampaign` never reads loss holding or stage (W:1581-1640). Week markers "Week n · about the size of a
  ..." arrive weekly at 9 AM (I:10094-10105) until she finds the take-back card. Vaccine and visit alerts name a lost
  baby with no take-back call-out for a twin. B16 says "after a loss it is empty" for shortcuts, against F3.
- Fix: R19. The Worker defers every campaign while holding, reading the household as P5's `pullLossHolding` does
  (P5:106); campaigns carry an audience stage (default: baby stage). The loss screen's first practical card hands back
  every calendar file in one tap (METHOD:CANCEL exists, I:9882-9892). Fix B16 to F3.
- Owner: new change (Worker campaigns, loss screen), reusing P5 T1's helper; B16 in the doc pass (G-24).

### G-06 (S2, All reminder users). C6 is not built, and is scoped to push only

- Surfaces: dose push, digest, confirmation, the page notification, the dose calendar alarm, the ticket payload.
- Now: "Calpol soon" / "Time for Calpol 5ml at 3:00pm" (I:8236); "Today with Robin" / "Medicines today: Calpol,
  Ibuprofen" (I:8246); "Calpol is on the record." (SW:132); `medName` in push data (W:1899). P1 T10 fixes these. Outside
  it: the page notification "Robin · Calpol · 5 ml is due" (I:15066-15070), the dose calendar alarm "Calpol 5ml"
  (I:10262-10264), and the signed ticket's base64 `mn` (W:2404-2411). T10 also cites :8232 and :8242, which are
  :8236 and :8246 in this tree.
- Fix: ship T10 with R6's body ("A dose is due within half an hour." rather than "You have a dose to give in the next
  half hour.", which assigns a task); if Q2 is yes, the page notification reads "Medicine due" / "A dose is due now."
  and the calendar alarm "Dose time" / "A dose is due. Log it in Cubby when you give it.", the name in the event notes;
  `mn` leaves the ticket. Extend the dose-push-copy gate to both, each with a staged presence.
- Owner: P1 T10; Q2 for the page alert and the calendar alarm (they join T10's file list on a yes).

### G-07 (S2, All). The copy gate cannot see most of glass

- Surfaces: every notification, calendar alarm, a future Live Activity, StandBy.
- Now: PG knows eight surfaces (tools/widget_parity_check.js:49), none a notification. T10 plans `DOSE_PUSH_COPY` as
  literals in worker.js and index.html. Live Activity strings would compile into Swift. That is how the banned "time
  for" (J:145) is live at I:8236 with every gate green. StandBy is not a surface in J or the model; its rules live only
  in Swift.
- Fix: R21. Add `push`, `calendar`, `activity` and `standby` surfaces to J; T10 takes its copy from J through
  tools/widget_gen.js; PG's rules (banned words, sentence case, no em-dash, no "?" on locked glass) then see every
  glass string, plus three new assertions: no `{med}`, `{dose}` or `{name}` placeholder in `push`, lower case after
  " · ", one apostrophe. Plant "Time for {med}" in a `push` key and "Robin · Sleeping" in a `lock` key; both must go red.
- Owner: P1 T4's gate (extend the surface list) and P1 T10 (consume J). This is the root fix: every other wording
  finding here exists because these strings sit outside the gate.

### G-08 (S2, All lock and StandBy users). A stale number that looks live

- Surfaces: lock rectangular, StandBy.
- Now: "Updated" is on home and small only (J `header.updated` `on:[home,small]`); fixture `lock-rect` carries a live
  `agoAt` and no freshness; B21 drops "Updated" from StandBy. Partner freshness is a best-effort silent push that iOS
  budgets, so "4 hr, 50 min ago" can grow at 3 AM when Dad fed at 1. The spec's own anti-goal: "A stale number that
  looks live".
- Fix: R11. The lock rectangular drops the ago line after one pull period and shows the clock alone (C1 holds: the
  clock stays the headline); StandBy keeps "Updated 3:14 AM" (it is the small widget enlarged, inside F11's intent).
- Owner: P1 T5 reference model, as a fix round with two new fixtures; P3 T6 draws it; P5 T8's merge sets the time.

### G-09 (S2, All who hide). "Hide details" says one place and means several

- Surfaces: settings row, lock widgets, StandBy, Mac, iPad lock, notifications, a future Live Activity.
- Now: label "Hide details on the lock screen", helper "The widget will show Cubby and nothing else." (J, approved on
  B20). P3:598 also turns medium and small into the wordmark in StandBy, on a Mac and on the iPad lock screen; B21 draws
  StandBy without mentioning the switch. No push path reads `users/{uid}.widget.lockHide` although the cron reads that
  document whole, so "Medicine due soon" still lands on the lock screen she just made private. The row shows only on an
  iPhone with a widget (P1 T9).
- Fix: R18. Label "Hide details when your phone is locked"; helper "On the lock screen, in StandBy and on a Mac or iPad,
  Cubby shows its name and nothing else."; with it on, the Worker sends "Cubby" / "You have a reminder."; show the row
  wherever reminders or a widget are on.
- Owner: founder (Q5, it changes B20's approved words and widens the switch), then P1 T4 (strings), P1 T9 (row), P1 T10
  (Worker reads the flag), P3 T6 (already behaves).

### G-10 (S2, All, monthly). The month day and the age disagree on the same day

- Surfaces: medium widget, the same widget on a Mac or iPad lock, Home, the in-app pill.
- Now: Home's age is `Math.floor(days/30.44)` (I:2230) and `ageOf` must equal it (P1 gate A5); month days use calendar
  months. Fixture `moment-today` pins header age "2 months old" beside moment "3 months today" for the same baby at the
  same moment, so the phone's home screen says "3 months today" while the same medium on a Mac or the iPad lock screen
  (age back, no star, P3:598) and Home read "2 months old". The governor measured 58.1% of month days disagreeing. In-app the pill says "Robin is 3
  months 🎉", and at 12 months "Robin is 12 months 🎉" against the widget's "1 year today".
- Fix: ageString and ageOf both count calendar months (setMonth from the birth date, I:3309, the arithmetic F10 names);
  A5 then still holds. Pill words "Robin is 3 months old 🎉" and "Robin is 1 year old 🎉". This fixes the anti-goal "a
  time computed differently from Home"; it does not reopen F10.
- Owner: new change in I and workers/shared/since-rules.mjs (P1 T3's module), before P3 ships (governor change 3).

### G-11 (S2, All). One fact, several vocabularies

- Surfaces: Home, the in-app sleep banner, notifications, the S08 board.
- Now: running nap: widget "Asleep now" / "since 2:40 AM"; Home since card "Last sleep" over "Asleep now" (I:4236);
  banner "Sleeping" / "47:12" / "started 1:20 AM" / "Stop" (I:5012, :5063). Long nap: widget "Still asleep?"; banner
  "This nap has been running 12h 5m. Did it end earlier?" (I:5018). Empty: widget "not logged"; Home "not yet"
  (I:5173). Failure: widget "That didn't save. Open Cubby to log it."; notification "Could not log that dose" / "Open
  Cubby and log it there, so nothing is missed." (SW:131-133) and "You look offline. Open Cubby and log it there."
  (SW:138). Undo: widget 10 seconds, in-app 5 seconds, S08 "for 10 minutes ... The same as the widget."
- Fix: R6 and R7. Glass failure lines use J's keys, the notification included (T10 already edits these lines).
  Home adopts the glass words where it shows the same fact (Q6). The S08 caption must not seed any build.
- Owner: P1 T10 for the sw.js lines; a new change in I after Q6; S08 in the doc pass.

### G-12 (S2, All small-widget users). The plans still draw the play glyph F11 removed

- Surfaces: small widget, Phase B on iOS and Android.
- Now: F11 fixed "the moon icon with Start or Stop" and J holds "Start" / "Stop", but P4:46 says the small widget
  "reads 'Sleep' with a play or stop glyph", P4:573 tests `play.fill` and `stop.fill`, P6:383 creates
  `ic_cubby_play.xml` and `ic_cubby_stop.xml`, and S:274 still describes the play glyph.
- Fix: the I.sleep crescent as a template vector in both binaries, the same moon as the in-app tile and any island.
- Owner: P4 T10, P6 T7 and T8, and the spec line, before those tasks start.

### G-13 (S2, Some). Vaccine alarm at midnight

- Now: `'TRIGGER:-P2D'` on an all-day event (I:16832) lands at 00:00 two days before, naming the baby. The doctor-visit
  export documents this exact trap and uses -PT15H (I:7753-7757).
- Fix: -PT39H (9:00 AM two days before), bump SEQUENCE so a re-export updates what is already in her calendar, and put
  every export under R4's ICS gate.
- Owner: new change (one line plus the gate).

### G-14 (S2, All push users). Feature nudges are on by default and nothing checks their words

- Now: `allow.feature` defaults to true (I:8010-8011), so turning reminders on for a medicine also opts her into "New
  in Cubby" up to five a month. Campaign title and body are free text (W:1668-1670) with no lint and no stage or loss
  check, so a pregnancy feature note can reach a trying user or a partner's phone.
- Fix: feature off by default with its own ask on the Reminders sheet; the Worker refuses a campaign whose copy fails
  R12 and R13 or names a stage; campaigns carry an audience stage (with G-05).
- Owner: new change; the default needs the founder's yes because it lowers campaign reach (section 5, smaller yeses).

### G-15 (S3, Some). Widgets outlive access and illness

- Now: with F2, a 401 from the snapshot route drops the pull and the token but leaves the app snapshot (P5:716, P6:500),
  so a removed nanny's home screen keeps "Robin · 2 months old" and its buttons until she opens Cubby. Health is one
  boolean set at export (S:367-372), so a widget whose app never runs keeps Health past F5's 14-day return.
- Fix: a refused pull writes the wordmark state; an app snapshot older than a few days draws the wordmark; the
  snapshot carries `healthUntil` and the native applies it.
- Owner: P5 T8 and P6 T10 (401), P1 T8 (snapshot field) with a P1 T5 fixture ("15 days old, healthOpen true, renders
  the pick").

### G-16 (S3, Many). A dose tap lands where the dose is not

- Now: the reminder arrives 15 to 30 minutes early and opens `/app/` (SW:145, W:1900); Home's dose pill appears only
  once the dose is due (I:4105). `data.medId` is sent and ignored.
- Fix: R17, a `go=medicine&med=<id>&baby=<id>` route next to the widget targets; sw.js opens it.
- Owner: P1 T7 (router, deeplink gate) and P1 T10 (sw.js click).

### G-17 (S3, Some). A digest that adds nothing

- Now: one digest at 9 AM every day any medicine is due, even a single daily vitamin already covered by its own
  reminder, even when the doses are given (I:8240-8247). Titled with the active baby, though the list covers every
  child (T10 removes the name).
- Fix: R15, only on days with two or more medicines; body "Your list for today is in Cubby." (informs, assigns
  nothing; T10's "Open Cubby to see what's due today." is an instruction).
- Owner: P1 T10 for the copy; the two-medicine rule is a small new change in syncReminderIndex.

### G-18 (S3, All new reminder users). The permission ask has no preview

- Now: saving a medicine with Remind on raises the OS prompt directly (I:14819, I:14852, I:15000-15009); the
  explainer sits on the Reminders sheet, not on that path, so a decline burns iOS's one prompt.
- Fix: one small card first: "Gentle reminders for medicines" / "One nudge before each dose, and quiet from 9:00 PM to
  7:00 AM. It will look like this:" with the real notification drawn from J's `push` strings, buttons "Turn on
  reminders" and "Not now" (honest, because it returns on the next Remind save). The OS prompt fires only from the
  first button.
- Owner: new change; a mockup on the Design canvas first, with the version you would not build (standing rule).

### G-19 (S3, Some). VoiceOver and large text

- Now: the logger is drawn but not spoken (fixture `small-default`: by "Dad", a11y "Robin's last feed, 2:10 AM"); the
  lock widget reads as three fragments, and " · " may be read aloud; "Checking" has no subject; Dynamic Type is capped
  at xxLarge; the ago line is 11pt (S:244).
- Fix: `a11y.lastFeedBy` "{name}'s last feed, {time}, logged by {by}"; one combined lock element ("Robin: last feed
  2:10 AM, asleep since 2:40 AM"); "Checking whether the sleep saved"; star and arrow hidden from VoiceOver; test AX1
  to AX3 (ago lines drop first, clock times never below 15pt); 12pt ago lines where the cell allows.
- Owner: P1 T5 (a11y in the model and fixtures), P3 T6 (views), P3 T9 (device proof).

### G-20 (S3 now, S2 when built). The Live Activity board contradicts the glass rules

- Now: S08 draws "Robin · Sleeping", a ticking "47:12", "started 1:20 AM", a bare "Stop", and Siri Undo "for 10
  minutes ... The same as the widget."; LAV's final state is "still asleep? open Cubby" (lowercase, with the question
  the lock screen bans). The S08 dose line "A dose for Robin at 8:00 PM" names the baby; B21 is newer and does not.
  A partner's stop cannot reach a running Live Activity through F2's silent poke: it needs a second APNs channel with
  per-activity tokens (iOS 17.2+ for push-to-start), so without it the two phones tell two stories. An activity also
  ends at about 8 hours while Home and the widget keep "Asleep now" to 12.
- Fix: decide Q1; whatever the answer, reserve `activity` keys in J now with R6's words, R10 (no counter), R18 (hide),
  R16 (Stop sleep through the nap route, needs unlock), and the final state "Robin · asleep since 7:10 PM" /
  `fallback.stale`.
- Owner: founder (Q1); the keys in P1 T4's file; S08 and LAV marked superseded in the doc pass.

### G-21 (S3, All iOS). The off-home fence is unproven and outside the model

- Now: P3 reads `@Environment(\.widgetLocation)` and treats unknown places as off-home (a good fail-safe), but nobody
  has recorded the values on a device. The spec lists off-home places differently in F7 ("lock screen, StandBy") and
  F10 ("lock screen, StandBy, a Mac or the iPad lock screen"); P3 applies the wider list to both. Buttons hide in
  StandBy only, so a shared family Mac draws "Health" while a baby is ill.
- Fix: R2. One off-home list in the spec; the model takes `location` with fixtures (G-07); on a Mac the fourth button
  shows the parent's pick. No ship until StandBy, Mac and iPad values are recorded; if StandBy cannot be told from the
  home screen, raise it (F7's name on the small widget and "never StandBy" cannot both hold).
- Owner: P3 T9 (device values), P1 T5 (model input), spec edit.

### G-22 (S3, Some). "On for this device" means every device

- Now: the sheet says "On for this device" (I:8100), but tokens live in one per-user map (I:8116-8130) and the cron
  sends to all of them; "Off" on any device deletes the whole map (I:8186-8189).
- Fix: Off removes this device's token; the sheet lists where reminders go ("iPhone", "Chrome on Mac") with a remove on
  each row.
- Owner: new change.

### G-23 (S3, Some). Calendar exports are silent about the lock screen

- Now: the export sheets say "You choose which calendar it goes in" (I:10235) and nothing about where alerts show.
  Week markers have no end; dose courses are COUNT-bounded (I:10243-10250).
- Fix: R4's one line on every export sheet; COUNT on week markers, so a loss strands at most a few weeks.
- Owner: new change.

### G-24 (S3, All). The spec and boards still speak the old words

- Now: S:223, :263, :784 "not yet"; S:542, :785 and B16 "Did it end earlier?"; S:354, :792 and B16 "then goes back."
  without "to your pick"; S:781 "At a glance"; S:274 and B16 the play glyph; B16 caption "within moments" overpromises
  partner freshness; B16 "after a loss it is empty" contradicts F3; B21 StandBy has no "Updated"; S08 as in G-20.
- Fix: bring the spec body (§6.1, §6.7, §8) and boards 16, 18 and 21 up to J and F11; mark S08 and the LAV wording
  superseded. Builders build from J and the plans, but boards seed the next build.
- Owner: a doc pass, with P3 T9's SPEC note.

### G-25 (S3, All iOS). The intro card

- Now: the card's headline, buttons and three steps exist only on B22 (D-17); J has none of them, though the spec says
  all copy lives there. "Not now" hides the card for good. "Start a sleep in one tap" is true only in Phase B.
- Fix: put every card string in J; the dismiss button reads "No thanks", with Settings' "Add a widget" as the way back;
  Phase A says "See the last feed at a glance." only.
- Owner: P1 T4 (keys) and the P3 web task F11 asked for (not yet written); mockup first.

### G-26 (S3, Android). No channel, no visibility

- Now: no `android` block on any FCM message (W:1895-1909), so dose reminders and news share one fallback channel and
  nothing asks Android to hide content on a locked phone.
- Fix: two channels in the Android shell, "Dose reminders" (high) and "News from Cubby" (low, silent); the Worker sets
  `channel_id` and `visibility: PRIVATE`.
- Owner: a new change alongside P6 (P6 plans only the silent poke).

### G-27 (S4, All push users). Small things on notifications

- The 30-minute heads-up is `time-sensitive` (W:1908), which pierces Focus for an advance notice (R15).
- No `sound` is set anywhere; on iOS dose reminders are likely silent by accident. Decide: soft default sound by
  day, none in quiet hours.
- In-app toast "⏰ Robin · Calpol · 5 ml is due" (I:15074): no emoji on glass-adjacent alerts.
- "3:00pm" (I:8225) and "21:00 and 7:00" (I:8102) against fmtClock (R8).
- Owner: P1 T10 (Worker apns block, copy) and a new change for the sheet.

### G-28 (S4, All). Three icon languages

- In-app uses the I.* line set; iOS widgets plan filled SF Symbols (`star.fill`); Android hand-drawn vectors;
  notifications use the full-colour app icon as the badge, which Android draws as a blank disc. The widget Health
  button maps to QUICK_ACTIONS health, whose icon is the thermometer (I:4634), the temperature glyph D4 keeps off glass.
- Fix: export the few glass glyphs (moon, star, arrow) from I.* as template vectors for both binaries; Health on glass
  is its label and arrow with no thermometer; a one-colour badge from the brand master.
- Owner: P3 T2 and T6, P6 T8; the badge under the one-cub brand tool.

### G-29 (S4, Some). Builder notes

- A running feed is invisible on glass: Home shows "Nursing · left" ticking, the partner's widget reads the last
  finished feed. If wanted later: "Feeding since 2:40 AM", no counter.
- "Open Cubby to catch up." can read as "you are behind"; "Open Cubby for the latest." is calmer. One key, so a change
  lands everywhere at once.
- With no sleep ever logged, the lock widget now leaves out its name line, so a parent with two lock widgets cannot
  tell which baby a bare "Last feed 2:10 AM" is for. Consider "Robin · last feed 2:10 AM" on line 1 in that case.
- `byMax` 12 is generated into app/since-rules.js but nothing applies it yet.

## 5. Founder decisions needed

Q1. Live Activities: keep them out of this iOS update and build a running-sleep Live Activity next cycle, to the
rulebook (start time and no counter, "Stop sleep" that needs unlock, on both caregivers' phones or on neither, which
means the Worker learns Live Activity push)?
Recommendation: yes. The widgets already answer "is she asleep, since when" on the lock screen; a Live Activity adds
a second story on the same glass until push-to-start exists, and the 6 Oct board's counter fails C2's own reasoning.
Approve the contract now so nobody builds from S08.

Q2. C6's scope: do the page's own "Medicine due" notification and the dose calendar alarm also stop naming the
medicine?
Recommendation: yes. Both show on a locked phone (the calendar one on every device that shares her calendar); the
name moves to the in-app pill and the event notes.

Q3. "Log it" (the open step before P1 Task 10): keep it with three conditions (offered only when one medicine is due
for that child, behind Face ID or unlock, never on a desktop browser, and a confirmation that states the time and
opens the dose), or drop it?
Recommendation: keep it with the conditions. Without them an unnamed button can record the wrong dose, or a dose
nobody gave, in her name.

Q4. Quiet hours: should they become a setting she can change, and should a medicine with doctor-set times remind at
its own time inside them, quietly?
Recommendation: yes to both. Today the evening dose of a three-times-a-day antibiotic gets no reminder at all, and
the sheet says otherwise.

Q5. "Hide details": should the one switch cover everything Cubby shows while the phone is locked (widgets, StandBy,
a Mac or iPad, notifications, any Live Activity), with the label "Hide details when your phone is locked", shown
wherever reminders or a widget are on?
Recommendation: yes. It changes B20's approved words; the behaviour then matches what a parent thinks she switched on.

Q6. Home's words: should Home adopt the glass words where it shows the same fact ("not logged", "Asleep now" /
"since 2:40 AM", "Still asleep?", "Stop sleep")?
Recommendation: yes, words only; Home keeps its layout and its ticking banner. F11 changed the widget alone, so today
the widget and the screen it opens disagree.

Smaller yeses (no design work): feature nudges off by default with their own ask (G-14); the intro card's "Not now"
becomes "No thanks" (G-25).

## 6. Mobbin references worth keeping

Mobbin has no baby trackers and no real StandBy captures; StandBy guidance is inferred from lock-screen widgets.
Only one flow was looked at (Flo reminders); run a flow search before the permission card is final.

Lock screen widget
- Borrow: [Oura, label left and time right on one line](https://mobbin.com/screens/1e3c0935-bc5d-447e-b230-e25ae8f3c398);
  [Any Distance, the state named in words](https://mobbin.com/screens/4ba75bbe-ea5f-4a7a-8555-97e5e25ee091);
  [Apple Fitness, a paused number dims, never vanishes](https://mobbin.com/screens/62ba21b5-463e-4eab-8add-837bed281d0a);
  [Sunlitt](https://mobbin.com/screens/dfe1dd5e-2194-45d0-bd1c-72484fc92956) and
  [Moonlitt](https://mobbin.com/screens/2185385b-262f-4fea-8738-251830644151), one calm line.
- Avoid: [Runbuds, alarm red](https://mobbin.com/screens/8ebcad43-ccca-4a8e-81c2-70a0496a0393);
  [Strava, a white slab at night](https://mobbin.com/screens/2f0e5080-5c7c-45f7-abae-9693533b8298);
  [Runna, tiny labels](https://mobbin.com/screens/fe0533c7-dbdd-4dbc-9709-a0897c8cc0be);
  [WHOOP, four facts competing](https://mobbin.com/screens/8e5c6a84-be67-48f2-89a1-4923f0a71f50).

StandBy (inferred)
- Borrow: Sunlitt and Moonlitt above, monochrome, large, no controls, one fact plus one quiet line.
- Avoid: [one year's dot grid](https://mobbin.com/screens/9323efb6-c985-4b5e-b0ef-16ad0927d838), calendar pressure.

Notifications and nudges
- Borrow: [Waymo, one fact and one verb](https://mobbin.com/screens/005286b9-d695-4f28-93df-7078793d80c1);
  [Instacart, nothing asked of you](https://mobbin.com/screens/3ef61bc6-79bd-4b40-b45a-76798e0b02e5);
  [Lifesum](https://mobbin.com/screens/407d6bc8-47d6-46c2-9a7f-4634fb5ea43e) and
  [Vocabulary](https://mobbin.com/screens/382f52c5-e441-49fa-94d0-c15ba972b0ef), a quiet-hours start and end;
  [Hims, reminder time chips](https://mobbin.com/screens/9d984fa9-dcfb-4eb6-97f8-4cd492075629);
  [GoodRx, reminders grouped by time](https://mobbin.com/screens/af4e6848-2499-48d7-bf89-d37765e10193).
- Avoid: [Transit, urgency and red](https://mobbin.com/screens/d01577d1-4853-4483-ad39-9fa15e9852a8);
  [Temu](https://mobbin.com/screens/2ac4e73b-5110-47a0-bc26-8d49d5397b3e) and
  [Grab](https://mobbin.com/screens/733856f0-30d9-419f-946f-a06ffda80f61), a countdown on a button and upsell chips;
  [Bump, game art](https://mobbin.com/screens/2087256b-ee52-44bf-8ca6-6b5fa9a05a6c);
  [Flo reminders flow, nag reminders for everyday logging](https://mobbin.com/flows/4042d78e-1495-44ad-a52c-db0dfe1a2fa4).

Confirmations and undo
- Borrow: [Finch, an undo that says when it was done](https://mobbin.com/screens/58d34e22-4941-4abd-85d7-b72e4f129197);
  [Amie, an undo pill on the confirmation](https://mobbin.com/screens/583eba8b-b47c-4e55-9645-0a03a560042f).
- Avoid: [Centr, a celebration in capitals](https://mobbin.com/screens/4a969640-f16f-4cbb-b113-94b52ce62507).

Live Activity and Dynamic Island
- Borrow: [Apple Fitness compact island, the shape (glyph left, time right), with the start time instead of elapsed](https://mobbin.com/screens/b6cbddbe-a2f1-4050-8ee5-10fe30ccf937);
  [Apple Fitness, the control swaps in place](https://mobbin.com/screens/e62de56f-10a9-4212-80fc-69dd96ca3887);
  [TIDE, a dark calm sleep card with one small pill](https://mobbin.com/screens/c7a0794f-ee6f-47cb-9ec0-0b000c9f509b).
- Avoid: [Yazio, a streak in the island](https://mobbin.com/screens/cc5f51c4-c7cd-4280-8498-e538bf35e7c0);
  [BitePal, a large mascot and 3am cheer](https://mobbin.com/screens/6367f897-015b-4f82-8ce7-0b4d21b5b4d0).

Home widget
- Borrow: [ChatGPT, labelled tiles](https://mobbin.com/screens/7f7bea6f-be53-461f-8119-395070d82df3), labels a
  half-asleep parent can read; the row of round buttons in
  [Google](https://mobbin.com/screens/9cc1b61e-466b-4fc0-b73c-885834f0111f) and
  [Grok](https://mobbin.com/screens/bc2d81cc-0842-45e7-b2eb-3f82e7b807f9) for touch targets only (Cubby keeps a label on
  every button, S:283).
- Avoid: [Alan, a zero with a flame](https://mobbin.com/screens/59d37b2f-8b61-4da5-8e95-e917a1b7f622).

Permission and reminder set-up
- Borrow: [Clue, a live preview of the exact notification](https://mobbin.com/screens/bac10508-ec7f-4fd5-9d8b-ebe06709edef);
  [Atoms, a sample notification before the ask](https://mobbin.com/screens/10e80f9a-ea1d-4c26-9f5a-54e5e48fac34);
  [Babbel, "Maybe later" with equal weight](https://mobbin.com/screens/6822290a-66cc-4897-a4cf-c265bab0f9d2);
  [Jira Cloud, a narrower choice](https://mobbin.com/screens/a75e0cc9-edd1-44f4-b90e-91f4580a1013).
- Avoid: [SmartThings, a bare system alert](https://mobbin.com/screens/ef6ebb5f-2443-4943-9b5c-64b87bbd5e96);
  [Snapchat, a pleading re-ask](https://mobbin.com/screens/f950bddf-d47d-43c8-93bb-8accd7f4167a);
  [Chick-fil-A, a reward as the benefit](https://mobbin.com/screens/6bff2339-b553-4737-aa73-bf717675a956).

Empty and private states
- Borrow: [Clue, "Data is hidden" in every size](https://mobbin.com/screens/2f801873-9b4b-4b3a-b37d-1e73db0638ee), the
  pattern behind "Cubby" alone; [Equinox+, a plain statement](https://mobbin.com/screens/f7f98300-4053-4e5d-ba16-523fd7df43e2).
- Avoid: [Fitbit, dashes for no data](https://mobbin.com/screens/a300c0c9-fdc4-4cf7-a38d-f0a99cd38eb2);
  [Journal, "No Current Streak"](https://mobbin.com/screens/9a1359c4-bac7-42f1-b546-8c5a4b9f1191).

Read and not adopted, because a fixed decision or the spec says otherwise: a StandBy headline in relative time ("Last
fed 2h 10m ago"; C1 makes the clock the headline); "Private until you unlock" on every locked widget (D2 approves times
on the lock screen); "Nothing logged yet" (F11 fixed "not logged"); a "Say it" pill plus four unlabelled icons (D4, F9,
the Say it hold); "Napping" and "Feeding" as status words (C2's "Asleep now"); "Snooze 1 hour" (the app's own "In 15
min" and "Not now"); a sleep card forced dark (P3 follows the system).
