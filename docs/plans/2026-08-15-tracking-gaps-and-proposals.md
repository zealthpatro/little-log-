# Where Cubby is not doing the best job

**2026-08-15.** Nineteen agents, grounded in the repo, every high or critical claim put through an
adversarial pass that tried to refute it. **8 survived, 4 were refuted and are recorded at the bottom**
so nobody re-proposes them.

Read this with the tested half beside it: [flows and edge cases](2026-08-15-flows-and-edge-cases.md).
362 flow openings, four life stages, furnished and empty, **nothing broken**. So none of what
follows is a bug list. It is where a working product stops short of the job.

## The one thing

> Change one button. openOnboardInvite (app/index.html:4739-4747) is the last screen of every setup path and its primary action is "Invite someone". Make it call openFirstLog() with firstLogLabel() as its text. Both functions already exist and resolve to the right sheet and verb per stage, and openFirstLog has exactly one caller today (the empty timeline, :3446). The measured failure is 282.6 hours from sign-in to first log and zero households reaching day seven, and this sheet is where that clock starts. The invite is the hardest thing in the app and it is currently the first thing asked, before a parent has any reason to believe the log is worth sharing. Demote it to a ghost row underneath. Minutes of work against the only number that is actually broken.

---

## Baby tracking

### 1. Make the primary button of openOnboardInvite call openFirstLog() with firstLogLabel() as its label, and demote "Invite someone" to a ghost row below it. Nothing new is built: openFirstLog (app/index.html:3446) and firstLogLabel (:3445) already resolve to the right sheet and verb per stage.  `minutes`

The designed happy path of the first session ends without a log. Six exits from that sheet and none writes an entry, on a product whose median time to first log is 282.6 hours. Every other item here only pays off for a parent who has logged something.

### 2. In sinceCard (app/index.html:3509), measure a feed from ev.time+ev.dur when dur exists, the way the same expression already does for sleep. Then put the clock time in the card: "Last feed / 2:10am / 1h 5m ago". fmtClock is already used by awayRecap at :2405.  `minutes`

This is the charter's own 3am question and Cubby gives a wrong answer to it. A nursing session that started two hours ago and ran 55 minutes reads "2h ago" when the baby came off the breast 65 minutes back, always erring towards "she is overdue". The charter's exemplar is literally "last feed 2:10", a clock time, and the card has never shown one.

*Charter: Charter persona 3, answer in one glance. A wrong glance is worse than a thin one.*

### 3. Add a duplicate-write guard in commitEvent/addEvent that ignores a repeat of the same payload shape inside about 800ms, and have closeSheet (app/index.html:3981) set pointer-events:none on the sheet for the length of its own 360ms transition. Same for the timer stop buttons.  `hours`

Two clicks on Wet writes two nappies; two on Log bottle feed writes two feeds. bottleVol sums those amounts into dayRecapText and visitSummary, so one fumbled tap in the dark turns 120ml into 240ml on the page a parent hands a clinician. saveDiaper already goes through commitEvent, so one guard covers every current and future sheet.

### 4. In saveSymptom (app/index.html:9536), when symptomDraft.symptom is 'Fever', call feverGuidance() in the same calm shape the temperature path uses, and route the under-three-months case to openFeverNudge with the reading omitted.  `hours`

'Fever' is the first chip in SYMPTOMS (:9225) and logging it produces toast('Logged Fever') and nothing else. The one sentence in the baby stage that protects a newborn, any fever under 3 months is worth a prompt call, is reachable only from saveTemp. A parent without a thermometer to hand gets silence.

### 5. Give the toast one action. Keep a lastWrite handle set by commitEvent, addEvent, stopFeed and stopSleep, render Undo, extend the toast to about 5 seconds, and hard-remove on tap so nothing lands in Recently deleted and nothing stamps editedBy. Clear on the next write or on tab change.  `days`

Correcting a 3am mis-tap is four taps in another tab, and correcting rather than deleting stamps editedBy/editedAt and leaves "edited by Maya" on a row the whole circle reads forever. The toast already supports opts.tapToDismiss (:1754) and no log passes it.

*Charter: Charter law: forgiving by design, everything editable, backdatable, undoable. Undoable is the part that does not exist.*

### 6. In openFeed (app/index.html:4024), replace the hardcoded side:'left' with the last breast feed's side, the way openPump already seeds side from the last pump at :4325. Show the fact under the toggle: "Last feed was left, 2h 30m ago."  `minutes`

openFeed's own comment states the rule, last-used method wins and amounts come from the last matching feed, and it honours that for method, amount, unit and content. Side is the one field that breaks it, so the most repeated decision of the night opens wrong about half the time and needs a correcting tap at the worst hour.

### 7. Extend the quickBtn guard (app/index.html:3370) from sleep to feed so the tile reads "Nursing · stop the timer" while one runs. Guard startFeedTimer (:4123) so a second start offers two honest doors instead of silently overwriting. Render timerBanner on every tab, not only from renderHome (:2849).  `hours`

Tapping Feed while a nursing timer runs destroys it: 18 minutes gone, no event written, no warning. Sleep is already guarded, so the same gesture means two different things on the same screen. And from Log, Album or Health there is no elapsed time and no Stop at all.

### 8. Add one optional single-line note input to renderDiaperSheet under the four kind buttons, the matching textarea to the diaper branch of openEdit (:4414), and a "Nappy notes" line to visitSummary.  `hours`

teach-data.js:86 promises "anything that made you look twice, in your own words" and the nappy sheet has nowhere to put it. eventDetail already has a branch to render e.notes for a diaper, dead code because nothing can write it. Blood, mucus, a colour change, the first nappy after starting iron: the most-asked-about observation of the first year has no slot.

### 9. Replace awayRecap's calendar-day filter (app/index.html:2391) with a per-uid last-open stamp in localStorage['cubby-last-open:'+quickUid()], the pattern notesSeenKey and wwHiddenKey already use, set from the existing visibilitychange listener. Recap everything since that stamp authored by anyone but me, capped at 24h. Header becomes "While you were away".  `hours`

The one card built to reward coming back is blind to the night shift, which is the shift a second person actually covers. A mother waking at 6am sees nothing about the 2am bottle her partner gave, because it is filed under yesterday's key. What she gets instead is "A fresh day with Aria".

### 10. Drop the day key from the notesSeen stored shape (app/index.html:2580-2593) and have unseenNotes (:2602) look back 36 hours instead of comparing dayKey.  `hours`

A handover note left at 10pm stops counting as unread at midnight, so renderHome demotes the day surface and the morning parent finds "Nothing yet today". The comment at :2583 states the assumption out loud, "only a note left today can be unread", and it is false for the one handover every household with a baby performs. The 200-id cap is already the backstop, so a 36-hour window still self-prunes.

### 11. Count the haveLog row in renderGetStarted (app/index.html:2348) per author, state.events.filter(e=>e.authorId===myUid()), the way tipsTicker already does at :2270. Branch the copy on role: a non-owner gets two rows, "Log the next thing you do, she sees it straight away with your name on it" and "Say hello" opening openNoteCompose.  `hours`

The checklist is keyed to the household, so a partner who joins on day three lands on a home screen already ticked by somebody else and is never onboarded at all. This is the identical per-person versus household bug the tips ticker diagnosed and fixed for itself four lines above.

### 12. Prepend an Illness block to visitSummary (app/index.html:9276) when an episode overlaps the window: name, started, day N, ongoing or recovered on date, max temperature and symptoms scoped to that episode. Give it its own h2 in openDoctorReport (:9396). The arithmetic already exists in renderIllness (:9155-9191).  `hours`

The two surfaces built for the doctor never touch state.illnesses. A parent in a waiting room because of a five-day tummy bug hands over a page listing temperatures and symptoms as loose facts, which never says there is an illness, when it started, or that it is still going.

### 13. Put a date picker on illness start, reachable from the illness card and from reopenIllness (app/index.html:9212-9217), writing startedAt with a history entry the way saveEdit does. Separately, make the temperature rows and the "Medicine given this illness" rows on the Health screen tappable to openEdit.  `hours`

startedAt is written once at :9205 with no second writer anywhere in the file, and illnesses live in state.illnesses so openEdit cannot reach them. A parent who logs on Thursday a cold that started Tuesday is stuck at "Day 1" forever, and the doses list at :9165 silently drops Tuesday's and Wednesday's because it filters on e.time >= ill.startedAt. The Health-row fix is the cheap half: from that screen the edit path is currently invisible for two of the three record types.

### 14. Add a typed birth weight (number plus unit) to welcomeBaby (app/index.html:8163) and to add-baby, written as a growth event at t=birth so it is the first dot on the existing chart. One line under Latest weight while the baby is under three weeks: "3.31 kg · 90 g below birth weight · day 4". One line in visitSummary. Keep the free-text field for the poster.  `days`

The single number the first two weeks turn on cannot be computed, plotted or reported, because birth weight is a decorative string at :5053 whose only consumer is the poster renderer at :12592. svgPercentile plots growthEvents() only, so a newborn's chart has no day-0 point, and welcomeBaby, the one moment Cubby is with a mother hours after birth, asks name, time, sex and country and not weight.

*Charter: No colour, no target, no verdict. A difference from her own baby's starting number, not from a population.*

### 15. Add an "Add to my calendar" row beside the date in openDoctorEdit, reusing _icsText and _icsStamp: an all-day VEVENT with TRIGGER:-P1D, a stable UID of cubby-doc-<docId>@little-cubby.com, a SEQUENCE on the doctor record, and a description carrying a /app/?go=visit deep link. Copy exportVaccineSchedule (:9937) almost line for line.  `hours`

A real appointment typed into Cubby produces nothing that can reach the parent: saveDoctorEntry stores nextVisit and the only consumer is upcomingVisit, an in-app pill visible only if she is already inside the app. The calendar pattern is proven three times in the same file and needs no APNs key, no cron, no server and no permission prompt.

### 16. Offer openBirthPoster (app/index.html:12335) as the second beat of the first session, one row in openOnboardInvite right after the first log. Then put it in the alert stack once during the first fortnight, from the slot the month card uses.  `hours`

It needs only a name and a birthday, renders missing details as dotted placeholders, produces a printable painted keepsake and stamps "made with Cubby". It is three navigations deep in Album and never offered anywhere else, and monthiversary() returns null while m<1, so the keepsake layer has nothing to give during the exact four weeks where activation is decided.

### 17. Make timerBanner tappable: a small sheet with "Started at HH:MM · change", "Stop now", "Stop at a different time" and "Cancel this timer", which clears state.timers and writes nothing. This is openSleepCorrect's control made reachable mid-timer rather than only at the 24-hour trip.  `days`

A running timer can only be stopped, and stopping always writes. Tap Sleep by mistake and the only exit is a junk nap you then find and delete. Forget to stop until an hour after she woke and you get an hour-too-long nap you must edit, which stamps the row as edited for the whole circle.

*Charter: Same charter law as Undo. The when-picker is already the house standard, so no new component.*

### 18. Move vaxCalendarRow (app/index.html:9931) above the vaccine list, next to the completion ring, and add it to openOnboardInvite beside the existing vaxProofLine.  `hours`

The strongest cold-start proof in the baby stage is the last row of a sub-tab, after the ring, the catch-up card, the disclaimer, 15 to 25 vaccine rows and two add-rows. The onboarding sheet already quotes vaxProofLine and offers "See their vaccine plan", then never offers the thing that puts those visits in her actual calendar.

### 19. Rewrite the Settings reminders row at app/index.html:5487. It reads "Gentle nudges for medicine, vaccines & rituals". Make it name what the sheet does: dose alerts, plus putting vaccine visits and dose times in your own calendar.  `minutes`

Rituals notify nothing and the app admits it two thousand lines away at :11088, and vaccines are calendar-only, which :9963 says outright. The row promises two channels that do not exist and the sheet it opens then contradicts it. In a product whose voice rules are honesty first, this is a real cost today and a one-line change.

*Charter: This is the salvage from the refuted push claim. Fix the promise, do not build the channel.*

### 20. Add 'Skin or eyes look yellow' to SYMPTOMS (app/index.html:9225), available from birth. For this one symptom relabel the mild/moderate/severe toggle to face / chest / tummy / legs. On save, one sentence in the feverGuidance register pointing at the midwife or health visitor today. Carry it into visitSummary with its dates, printed next to the wet-nappy count from the same days.  `days`

The commonest reason a newborn goes back into hospital has nowhere to be written down. The triad a paediatrician acts on is yellowing plus a sleepy or poorly feeding baby plus few wet nappies, and Cubby logs the second and third. reads-data.js:61 already explains that the yellow spreads face-downward, and then the app has no slot for what she saw.

### 21. Add a relative row above the columns in openWhenPicker (app/cubby-extras.js:518): Just now, 15 min ago, 30 min ago, 1 hour ago, 2 hours ago, each setting the value and closing. Collapse the month calendar behind a "a different day" row, keeping Today and Yesterday as chips. Leave the columns underneath untouched.  `days`

Saying "actually that was twenty minutes ago" costs two nested scrollers. The minute column is 3020px of content in a 200px window, so moving 3:12 to 2:45 is 1584px of one-handed scrolling, and the calendar occupies 357px answering a question that is almost never the one that is wrong about a log made at 3am.

### 22. Give wakeWindow's not-yet state a voice once, where it is earned. When a nap is stopped and w.enough is false, the confirmation says what her own log will be able to answer. Once the data supports it, one line on the Log surface in the cycleLengths register: "Over the last two weeks Aria has usually been ready to sleep again about 1h40 after waking."  `hours`

The only forward-looking thing in the baby stage needs roughly six completed naps before it can speak, wakeWindow() already returns {enough:false, have, need} that no caller reads, and against 16 lifetime events no parent has ever seen the line. The trying stage already proves the voice works: "Your last 4 cycles ran 26 to 33 days. Just what happened, not a forecast."

*Charter: A description of the past, never a schedule. No target time, no countdown to the next nap, no due, no colour, no push, and never a count of what is missing. At most twice for the not-yet line, dismissible for good.*

### 23. Decide the pump stash. Build: a running balance on Log or Health, credited by every pump event, debited when a bottle is logged with content:'breastmilk' (the feed sheet already captures that field), plus one manual "used some" adjustment. One line, her own unit. Do not build: cut the promise from app/teach-data.js:100,107 and app/log-guide.js:81-83, and at minimum add pump to dayRecapText and visitSummary.  `days`

Cubby promises "your stash lives in one place" and "anyone in your circle can see the stash without asking you for a number" in three places, and there is no stash. Pump appears in the timeline and in nothing else: not renderStats, not the today strip, not dayRecapText, not daySurfaceRecap, not visitSummary. Leaving the teaching layer contradicting the app is the worst of the three options.

*Charter: No target, no colour, no goal line on the balance.*

### 24. One optional field at the birth handover, "Born at __ weeks + __ days", pre-filled from p.dueDate, stored as b.gestWeeks. Then babyAgeMonths returns corrected age for the growth chart until 24 months corrected with a caption naming which age it plots and a tap to switch, renderNudge uses corrected months and says so in one clause, and feverGuidance's under-three-months branch uses corrected age. For a term baby gestWeeks is 40 and nothing changes.  `days`

welcomeBaby holds p.dueDate and the birth date in the same function and throws the gestation away. Grepping for gestation, corrected, preterm or premature returns nothing in the baby stage, so a preterm baby is plotted on term WHO curves, nudged on term milestones, and loses the under-three-months fever rule early.

### 25. Between 23:00 and 05:00 on the baby home, hold the hero still (skip the initHero 4500ms interval, keep the photo and the dots) and move the Quick log block above the hero. Say nothing about it. Reverts by itself at 5am.  `days`

Cubby already detects the hour and spends it on two lines of warm copy. Measured at 03:12, 390x844: the largest thing on screen is a 263px full-brightness auto-advancing photo, Feed and Sleep sit at y=555 with subtitles clipped by the nav, and Nappy shows 47 of its 144 pixels. Nothing is hidden and nothing is dimmed. Her baby's face stays where it is.

*Charter: No banner, no "night mode on", no suggestion she should be asleep.*

### 26. One card on the Log surface while the baby is under three weeks, stating yesterday as four facts: "9 feeds · 7 wet · 3 dirty · longest gap without a feed 4h 10m". Prepend the same block to visitSummary while the baby is under a month.  `days`

Every number is already in the log and none is assembled into the view a midwife builds at every early visit. sinceCard answers when the last one was, the today strip answers how many so far, and visitSummary prints a fortnight of averages. None of those is the question being asked of her in the room.

*Charter: Numbers only. No target, no colour, no comparison to any norm.*

### 27. Replace feverGuidance's second sentence (app/index.html:9337) with a safety net rather than a duration: what would make you call sooner, in plain words, with no number Cubby invented. Drop "keep them comfortable and hydrated". If a duration is wanted, cite a source and link it the way the pregnancy screens do.  `hours`

It currently reads "reach out to your doctor if the fever is high, lasts more than a day or two, or they just seem unwell". The first clause is care advice, "if the fever is high" is circular since it already is a fever, and "a day or two" is a duration with no source. Every other clinical number in the repo is sourced, and the wake-window comment at :3004 states the governing rule outright.

### 28. While the baby is under six weeks, offer three optional colour chips under the Dirty button: dark, green, yellow, plus "pale or chalky" with the same one-sentence treatment as jaundice. Roll the colour into visitSummary's nappy line for the newborn window and drop the chips at six weeks. Rides on the same sheet change as the nappy note.  `days`

A dirty nappy is one undifferentiated button, so the day-5 milk-transfer question a midwife asks cannot be answered, and a pale or chalky stool, the flag for biliary atresia whose surgical window closes around eight weeks, has nowhere to go.

### 29. Add an optional third field to the measurement sheet for head circumference (cm/in), stored as ev.head/hcUnit, shown on the timeline detail line and in visitSummary. Add WHO 0-24mo and CDC 0-36mo head-circumference bands to app/growth-data.js so it plots with the same svgPercentile code.  `days`

Every well-baby visit in the UK, US, India and the UAE measures three numbers and a parent leaving the clinic can write down two. growth-data.js carries no head bands at all, so there is not even a reference curve to plot against.

### 30. Store the solids selection structurally as payload.foods = [{n,a}] alongside the existing notes string so nothing old breaks, then add one calm read-only panel to the Food and allergies sheet: the nine allergens, each showing "first tried 12 Aug" or "not yet". Feed the same block into visitSummary.  `days`

SOLID_FOODS tags each food with its allergen and saveSolids collapses the whole selection to notes = foods.join(', '). The tag's only use today is a warning triangle on foods the family has already declared an allergy to, which is backwards from the job. Nothing can answer "have we introduced egg yet, when, and did anything happen", the guideline-driven task of months 6 to 12.

*Charter: No checklist framing, no progress ring, no due. A record of what happened, never a list of what is outstanding.*

### 31. Two optional fields on the medicine sheet for as-needed entries: "smallest gap between doses" and "most in 24 hours", typed by the parent off the bottle in her hand. When either is exceeded, show the existing confirmSheet with her own figure: "You wrote no more than 4 in 24 hours. This would be the 5th since 06:20."  `days`

logDose asks its calm double-dose question only when medIntervalMs is non-zero, and that returns 0 for anything not everyX or daily. Paracetamol and ibuprofen are the two medicines in a house with a baby and are almost always entered as needed, so the class most likely to be double-dosed by two caregivers is the one class that gets no question. The comment above lastDoseLine names this as the most frightening recurring question in the domain.

*Charter: Cubby still invents no interval and no dose. It asks her own number back to her.*

### 32. Port visitQs to the baby stage as "Things to ask", one add-row on openDoctor (app/index.html:5037) and its own section at the top of the printed report. Add a Birth history block built from the birth weight and gestation fields above, plus one free line.  `days`

openDoctorReport prints Last 14 days, Latest measurement, Vaccinations, Active medicines, and has no place for why the family came, which is the first thing a clinician should read. The pregnancy stage already has the right instrument in visitQs and defaultVisitQs; the baby equivalent never got it.

### 33. Give openFamily an entry mode. Opened from an invite CTA rather than from Settings, lead with the Invite link row: one button, the share sheet, done, with the strict email invite and the profile fields collapsed below. Same modal, same code, different order.  `hours`

Every invite CTA in the product, the onboarding sheet, the get-started row, the visit-prep card and the Settings row, lands on a screen that opens with the family portrait and the inviter's own profile fields. The one-tap share path is the third block down.

### 34. One line, once, in the confirmation of the very first entry: a statement of capability, not a task. "That is the first one. From here, when did she last feed is the top of your home screen."  `hours`

saveDiaper ends in toast('Nappy logged · wet') and renderGetStarted returns '' the moment haveBaby && haveLog, so the parent who does exactly what she was told loses the only structure on the screen and gets a two-second toast in exchange. Nowhere does the product explain what her own log will be able to answer once there is a bit of it.

*Charter: No count, no next step, no target, never repeated. Same shape as the wake-window not-yet line.*

### 35. A CSV importer for the two or three largest exporters, reachable from the same Settings row as Export (app/index.html:5569). Map feeds, sleeps and nappies with their original timestamps, attribute them to a synthetic "before Cubby" author so nothing lies about who logged what, and show a plain count preview before writing.  `days`

Cubby has export and no import at all: every match for import or migration in app/ is an internal schema migration. Nara, ParentLove and the rest all export CSV, so the data is sitting in a file on her phone and Cubby refuses it. For a challenger, switching cost is the whole fight and Cubby currently charges the maximum.

### 36. Replace the three manifest screenshots (app/manifest.webmanifest:20-24) with real captured UI of the three things no rival can show: two names on the same timeline, the mood note labelled "never, for anyone", and the loss-holding screen. Fix privacy/index.html:50, which still reads "[Legal entity, to be confirmed]". Then finish the store submission.  `days`

The declared screenshots are captioned marketing posters, not the product, so a parent who reaches the listing never sees it. The two things Cubby is genuinely best at, loss handling and legible privacy, are invisible at the moment a parent chooses, and a controller field reading "to be confirmed" sits on the exact page the privacy claim points at.

### 37. An ask box on Home and on Health that does retrieval only over the article corpus already chunked per Q&A pair. Returns one short paragraph in Cubby's voice plus the link to the full read. A fixed red-flag term list short-circuits to the warning-signs sheet and the care-team phone number rather than to an answer.  `days`

"Is this normal?" is the most-repeated job of the first year and Cubby has no answer to it inside the app. It owns 661 articles in exactly the right voice and cannot serve one in response to a question: the only two search inputs, glSearch and pglSearch, both filter moments, and goodReadCard is pull-only. So at 2am she leaves for Google.

*Charter: Never generative about her specific case, never a diagnosis, never a probability.*

### 38. A lock-screen and home-screen widget showing the same three since-values Home computes, fed by App Group shared storage written through a small Capacitor plugin on every log, plus a Live Activity for a running feed or nap driven by the existing state.timers. Both are read-only mirrors. Do this last.  `weeks`

Cubby has no presence on the phone between opens and the whole comparison set does. But this is weeks of Swift, and a widget amplifies a logging habit that eleven households have not formed. It becomes the right investment once ranks 1 to 11 have moved day-two return, and it is the wrong one before that.

---

## Pregnancy tracking

### 1. In saveBP (app/index.html:7620), run bpFlag() on the new reading regardless of whether the 'bp' condition tracker is on. Raised, show the calm toast plus a one-tap "Signs to watch for" row built from cfg.symptoms. Severe, or raised alongside any of those symptoms, replace the toast with a small sheet carrying the reading, one plain sentence, and the care-team call button pregDoctorCard already builds from p.careTeam[0].phone. Same for the BP field inside markApptDone.  `hours`

saveBP answers every reading, however severe, with toast('Saved'). The severity logic exists at :8401 with the 140/90 and 160/110 thresholds from pregnancy-data.js, and it is called from exactly one place, a history list only reachable if she opted the tracker on. Meanwhile the Care tab's Blood pressure tile goes straight to saveBP with no tracker required. saveGlucose two hundred lines later already does this correctly.

*Charter: Never a diagnosis, never a colour on the home screen. "Calling is always the right answer when you are unsure."*

### 2. Add 'Vision changes' and 'Pain under my ribs' to the openLogSymptom chip row (app/index.html:7566). In savePregSymptom, match the entry against PREG.conditions.bp.symptoms and on a hit append one calm row in saveGlucose's shape, with the care-team call button underneath. When two land inside 24 hours, or one lands within 24 hours of a raised BP reading, say that plainly and lead with the call button.  `hours`

The pre-eclampsia symptoms are offered as one-tap chips and saving them is silent. There is no vision chip at all, and the chip most likely to be tapped for epigastric HELLP pain is 'Heartburn'. savePregSymptom pushes {kind, note}, toasts 'Logged' and stops, and nothing but the timeline ever reads the set.

*Charter: Not a diagnosis, an action. "Lots of people get this in pregnancy. Because it can also be worth checking, it is worth telling your midwife."*

### 3. Read pregWeek() inside openContractions (app/index.html:7754). Before 37 weeks, replace the 5-1-1 card outright with "regular tightenings before 37 weeks are worth a call now, whatever the timing says", plus the care-team call button. From 37 weeks keep the card exactly as written. Drop the freqMin>=3 floor.  `hours`

contractionStats (:7742-7752) computes fiveoneone from frequency, duration and count with no week check anywhere, so a woman in suspected preterm labour is told she has not reached the threshold yet. renderPregHome withholds the tile before week 36 and its comment says why, but openContractions is reachable from the Care tab side-item and from the quick-log button. Separately the freqMin>=3 floor makes the card vanish once contractions come closer than three minutes apart, which is the wrong moment to go quiet.

### 4. Add const canWrite = pregJourneyIsOwner() at the top of renderPregLog and pass it down, mirroring renderPlanningPartnerHome (app/index.html:6941-6949). When false, render appointments, visit questions, bag and birth plan as read-only rows, drop the Quick log block and the moments add-row, and say once why. Then move visitQs out of the owner-only journey doc into the shared app blob so the partner has one thing that genuinely writes.  `days`

A shared partner sees the whole pregnancy Care tab and can tap every control in it, and none of their writes reach the cloud: syncPregJourney returns early unless p.ownerUid === uidNow, firestore.rules allows writes only from the owner, and the next journey snapshot overwrites the optimistic UI. He can mark an appointment done, fill in the whole visit-outcome form, pack the bag, edit the birth plan and add a scan photo, and all of it evaporates. The trying stage already fixed exactly this and its comment calls the alternative "a lie dressed as a feature".

*Charter: visitQs carries no health data. It is "is my baby growing on track?", the one pregnancy list that is about the appointment rather than about her body.*

### 5. Persist kickSession and contractionRunning onto the pregnancy record as p.kickOpen and p.contractionOpen, restore on load, clear on finish or cancel. Render elapsed time through data-timer so startTick's _tickTimers loop drives it. Add the running contraction to the pregnancy shell as a timerBanner. Change tapKick to increment the count node in place instead of calling openKickCounter().  `days`

Both labour tools are module-level variables (:7646, :7664), so a reload, an iOS PWA relaunch or a service-worker update silently discards a session in progress, at the single worst moment in the product. Neither ticks: both render a static fmtDur that freezes until the next tap, and a running contraction disappears entirely when the sheet is dismissed. The machinery is already in the file and the baby shell uses it.

### 6. Widen the pregnancyArchive entry in savePregnancy (app/index.html:7080-7085) beyond {id, endedAt, weeks, loss, bornBabyId, moments, journey} to carry at minimum careTeam, appts and their outcomes, bloodGroup, rh, gbs, birthPlan, birthAt. Seed the new pregnancy from bloodGroup and rh rather than asking again. Then give the archive a door: a "Your earlier pregnancies" row in openBabySheet and in Settings, opening a read-only openPregRecord per entry, plus one plain sentence in openExpectingSetup.  `days`

Starting a second pregnancy destroys the first one's record. openPregRecord reads exactly the keys the archive omits, and it is reachable only through the look-back shell which requires state.pregnancy.bornBabyId, so the first record becomes both deleted and unreachable the moment the second journey starts. What survives is reachable only through openKeptMemories, whose two callers are the loss-holding screen and openExpectingSetup, neither of which a mother with a live second pregnancy can reach. teach-data.js:573 sells this screen as "a second pregnancy never writes over the first".

### 7. Give the trying-stage record a reader in the expecting stage and a survivor on the loss path. confirmPositiveTest sets p.stage='expecting' in place, so periods and observations ride into the pregnancy intact; add them to pregVisitSummary and put reportCard, or a read-only equivalent, somewhere reachable after conception. Then include {periods, observations, tryingSince, precon} in the endPregnancy(true) archive, and in the planning branch of confirmEndPregnancy add a "Take your notes with you" row opening openTtcDoctorReport plus a reworded confirm that names what goes.  `days`

This is the sharper version of the stop-tracking claim. periodHistory() and obsEntries() are called only from planning-stage render code and from ttcVisitSummary, and pregVisitSummary never touches them, so the moment she conceives a year of cycle dates and up to two hundred observations become unreachable inside the app. Then endPregnancy(true), the branch labelled "Keep my memories", archives moments and journey and deletes the rest. A woman who tried for a year, conceived and lost the pregnancy loses the entire record of the trying, on the keep button. Same treatment for moodLog, which two long comments elsewhere insist belongs to her and not to a pregnancy.

### 8. Add optional at (ms) and place (string) to the appointment record. openAddAppt and openApptEdit gain the existing in-sheet date/time picker and a place field; week stays and remains the sole source when no date is set. pregNextAppt sorts by at when present, the home card reads "Tuesday 3:15pm · St Mary's", and addApptToCalendar writes a real timed VEVENT with a stable UID of cubby-appt-<a.id>@little-cubby.com, a SEQUENCE on the appointment and a METHOD:CANCEL path. Copy exportDoseCourse and cancelDoseCourse wholesale.  `days`

An appointment is {week, title, note} with no date, no time and no place anywhere in the pregnancy stage, so everything downstream is an estimate: the home card says "in about 3 weeks" and the .ics back-computes a date from the due date and tells her to confirm it with the clinic. That .ics uses a fresh random UID with no SEQUENCE and no cancel, so re-exporting after a reschedule leaves two wrong all-day events in her calendar. The medicine exporter forty lines below already solves all of it and carries a comment about never leaving an orphan.

### 9. Give QUICK_ACTIONS an optional minWeek and have quickAvailable drop entries below it when the stage is pregnancy: kicks 28, contractions 36, matching renderPregHome exactly. Keep both selectable in openQuickSettings for anyone told to monitor early.  `hours`

renderPregHome deliberately withholds the kick and contraction tiles until weeks 28 and 36, and its comment explains that a count-movements tile too early only worries and that 5-1-1 is a labour tool. QUICK_DEFAULTS.pregnancy is ['kicks','contractions','symptom'] and quickAvailable filters on stage only, so the floating button offers both from week one on the same screen that is hiding them. One rule instead of two.

### 10. Add a "Log a reading" row to openPregRecord, owner-only, opening openLogBP unchanged, and a matching Settings row beside "How you are, in yourself", gated on state.pregnancy && state.pregnancy.bornBabyId && pregIsOwner(). Ship it with the saveBP flag from rank 1 so a raised postpartum reading gets the same answer as a raised antenatal one.  `hours`

openPregRecord tells her postpartum blood pressure still matters and its own header comment names the reason, pre-eclampsia presenting after delivery, and then gives her no way to record one: the screen is read-only, the look-back shell has no tabs, and there is no maternal-health surface in the baby stage. The only maternal thing that survived the handover is the private mood note, whose comment at :5484 explains exactly this class of orphaning. The sheet, the store (p.bp survives the birth) and the privacy gate all already exist.

### 11. When two or more completed cycles exist, drive fertileEstimate from the median of cycleLengths() rather than p.cycleLen, and span her shortest and longest recorded cycle rather than a fixed ovulation-minus-five. Name the source in the card: "Somewhere around 12 to 19 October, from your last four cycles." Keep the honesty line verbatim and keep cycleLen as the first-cycle fallback.  `hours`

fertileEstimate computes from the single cycle length she typed at setup and may never have revisited, while cycleLengths() fifty lines above derives her actual completed cycles and feeds the honest range card on the same screen. So one screen shows a range built from her body directly above a window built from a month-one guess.

*Charter: Still not a prediction of fertile days. It is her own recorded spread, described, which is what the range card already does.*

### 12. After three or more saved sessions, add one line above the tap button in openKickCounter: "Your last six sessions reached ten in about 20 to 35 minutes." When the session in progress passes her longest recorded time, do not colour anything; surface the line the sheet already carries at the bottom about contacting the midwife.  `hours`

teach-data.js:449 promises "you learn what usual looks like for your baby, which is the thing that makes a change worth mentioning", and finishKicks stores {start, end, count} while the sheet shows five raw rows. Nothing computes her baseline, so the mother is left doing the comparison in her head at the moment she is least able to.

*Charter: A range from her own data, phrased about the past, in the cycleLengths voice. No threshold, no alarm state.*

### 13. Append the birth plan to pregVisitSummary as its own section, gated the way openPregRecord already gates it. Add a "Share this" button inside openBirthPlan reusing sharePregReport with just the plan, so it can go to the partner as text without spending a report taste. Print the ticked and unticked bag list on the report too, and restructure defaultBag by owner: for you, for the baby, for whoever is with you.  `hours`

The one document written specifically to be handed to somebody else on a day she cannot explain it out loud has no hand-over: pregVisitSummary assembles ten sections and never touches birthPlan or bag. teach-data.js:558 promises "something you or your partner can hand over". defaultBag is nine generic items and misses the ones the teach copy itself advertises, like a going-home outfit one size up and snacks for the birth partner.

### 14. Move precon out of the owner-owned journey doc into the shared app blob so the preconception checklist is genuinely tickable by a partner. Let him add items, and show who ticked what using the existing loggerName pattern.  `days`

renderPlanningPartnerHome shows a non-carrier exactly three things: a privacy explainer, a read-only checklist and two articles. Every other trying-stage function is carrier-gated or owner-gated, so the stage meant to open the funnel contains nothing two people can do together. precon carries no health data, it is folic acid, a dentist check, easing off alcohol, and it is already rendered to him today, just uninteractively. That one move turns the only thing he can see into the only thing he can do.

*Charter: The honesty of the current gate is correct and stays. This makes one item genuinely writable rather than faking the rest.*

### 15. Write pregProofLine as the mirror of vaxProofLine and put it in the pregnancy branch of openOnboardInvite: "Your NHS care plan is ready: 13 appointments, from your booking visit to 41 weeks." Add a whole-schedule exporter next to it, one VEVENT per appointment, built the way exportVaccineSchedule builds the vaccine file.  `days`

savePregnancy has just generated 7 to 13 named, sourced appointments from a single date across 15 verified national schedules in pregnancy-data.js, and there is no pregnancy equivalent of vaxProofLine anywhere in the file. The strongest cold-start proof in the product is created and never announced, and addApptToCalendar writes one event at a time from one appointment deep inside openVisitPrep.

### 16. A "put my weeks in my calendar" export alongside the antenatal one: one all-day event per remaining week, titled "Week 25 · about the size of a {size}", carrying the /app/?tab=week deep link, no alarm louder than a same-day display. In-app, the first open after the week rolls shows the hero with a one-line "Week 25 starts today", dismissed by being seen.  `hours`

PREG.weeks carries 38 chapters and pregWeek() is recomputed on render, so the screen simply becomes different at some point during a Tuesday and looks identical on the Monday before. For a stage whose logging cadence is near zero, the week turning is the only recurring reason to open the app, and the product does not mark it or put it anywhere she will see it with the app closed.

*Charter: Marking a week that has arrived is not a countdown. No days-remaining number, no progress bar.*

---

## Explicitly not doing, and why

- Do not add a 'circle' push category, and do not widen the push channel beyond medicine. It contradicts the explicit policy in docs/plans/2026-08-08-reminders-and-import.md:290-295 and the in-app promise at app/index.html:5266, and it cannot work as an activation fix: a push about somebody else's log only fires after that log exists, and two people logging on the same day has happened zero times in eleven households. The salvage is the one-line honesty fix at :5487, baby rank 19.
- Do not send an evening email recap of what other people logged. Same objection. It fires only in households that already have the behaviour it is meant to create, it is silent for the solo household which is the modal case, and a recap of activity is one small step from a recap of inactivity.
- Do not add timeStrip to the temperature and symptom sheets. It is convenience, not correctness: both are already backdatable from the Timeline. The cheaper fix that closes the real gap is making the temperature and dose rows on the Health screen tappable to openEdit, folded into baby rank 13, where the genuinely uncorrectable field, illness startedAt, is also fixed.
- Do not put a time picker inside the too-soon dose confirmSheet (app/index.html:9008-9013). That flow was deliberately built as one question made of facts for the 3am double-dose case, and commitDose is reached from the medicine card and from dose alerts where 'now' is the true time. A branch there degrades the one screen that is already right.
- Do not add a fourth detail slot to .since-card. Rejected in favour of two cheaper changes that answer the same question better: the clock time on the card, baby rank 2, which is what the charter actually names, and carrying the last side forward in openFeed, baby rank 6, which answers 'which side' at the point of logging rather than one screen away.
- No streaks, no counts of what was not done, no completion rings, no due. This rules out a wake-window countdown or a 'nap due at 14:20' (rank 22 is past tense only), a progress ring on the allergen panel (rank 30 shows 'first tried' or 'not yet', never 'x of 9'), a days-remaining bar on the pregnancy week card (pregnancy rank 16), and any 'you have not logged today' anywhere. The not-yet lines in baby ranks 22 and 34 must never state how many entries are missing.
- Cubby still refuses to predict fertile days. Pregnancy rank 11 changes the input to the existing window card from a setup guess to her own recorded cycle spread and names where the number came from. It adds no prediction, no peak day and no ovulation marker, and the honesty line stays verbatim.
- Do not build the pump stash halfway. Either build the balance or cut the three promises in teach-data.js and log-guide.js. A partial stash, for example a lifetime total with no draw-down, would be a worse lie than the current silence because it would look like a number she can rely on.
- Do not start the native widget and Live Activity work yet. It is real and correctly diagnosed, and it is weeks of Swift for a product with 16 lifetime events. A widget amplifies a logging habit; eleven households have not formed one. Revisit once baby ranks 1 to 11 have moved day-two return.
- Do not ship the appointment .ics before the appointment has a date. Pregnancy rank 8 must land as one change: adding an exporter on top of a week-derived guess would write more wrong all-day events into her calendar, which is the current bug made faster.

## Claims that did NOT survive verification

Recorded because a plausible wrong finding costs more than a missing one.

- 'Nothing Cubby knows can reach a phone unless the family has added a medicine' and 'zero outbound signal, ever'. False for the modal healthy newborn: off-app reminding is deliberately routed through the parent's own calendar, and vaxCalendarRow (app/index.html:9931) exports the vaccine schedule with a 2-day alarm, plus antenatal appointments with a 1-day alarm and dose courses. Push being medicine-only is documented policy, not an oversight. What is real underneath is a copy bug at :5487.
- 'Temperature, symptom, medicine dose and illness-start are the four things that cannot be backdated.' Only illness startedAt is genuinely uncorrectable: written once at :9205, no second writer, and illnesses live in state.illnesses so openEdit cannot reach them. Temperature and symptom events are editable from the Timeline; their sheets simply lack a time strip, which is ergonomics. The dose portion should be dropped outright.
- 'Home's three answers give the clock and nothing else, so add a detail slot.' The card gives the elapsed time and never the clock, which is the opposite of the claim and is the thing the charter names. And the field that forgets is the sheet, not the card: openFeed derives method, amount, unit and content from the last matching event and then hardcodes side:'left' at :4024, against its own stated defaults rule.
- 'In the trying stage, Stop tracking deletes everything and that is the worst case.' The planning branch does lack a keep option, but that user is standing on the screen that holds her report. The severe case is one stage later: confirmPositiveTest carries the trying history into the pregnancy where nothing can read it, and endPregnancy(true), the branch labelled 'Keep my memories', then deletes it.
