# Reminders, vaccine-card import, and per-subject medicines — 2026-08-08

Founder asks, verbatim: "lets work on making all reminders work properly where needed let us
integretae with os calendar and render alarm alert mechanism with push or live tracking and maybe
even haptic where rleenavt" / "can i uplaod a image of my previous vaccines taken ? that can be a
pro feature" / "the voice note is a permant running mike that is not cool no ?" / on adult
medicines: "it is more for one user no ? either the mom or the baby or the twins".

Four research agents (delivery mechanisms, vaccine-card import, per-subject medicine schema, then a
planner reconciling against the code).

SHIPPED from this on the day: sw v259 (mic no longer hot on open, date-picker year control, sign-in
disclosed at every CTA), sw v260 (the medicine calendar course + the multi-baby dose alert fix +
requestNotif guard + commitDose reindex + honest REMINDERS_LIVE comment, gated by
tools/dosecal_test.js). Sections 2 and 3 below are NOT built.

All six-plus load-bearing claims verified against code. **Two lanes share a factual error I have to correct up front**, because a whole proposed workstream rests on it.

---

# CORRECTION BEFORE THE PLAN

**`state.settings.push` is NOT in the shared household blob.** Both the delivery lane ("same shape as the A5 push bug") and the medicines lane ("quiet hours are per-household") are wrong.

- `app/store-firebase.js:698-702` — `sharedSettings()` does `delete s.seen; delete s.push; delete s.theme;` before the blob is built.
- `app/store-firebase.js:866` — `var localPush = state.settings && state.settings.push; // reminder on/off + quiet hours: per-device`
- `app/store-firebase.js:871` — `if (localPush) state.settings.push = localPush;` re-applied over every incoming snapshot.

Quiet hours and the enable flag are already per-device. **Delete that workstream.** (Residual, minor: per-*device*, not per-*uid*, so two accounts on one phone share them. Unlike `proTaste`, which is in `state.settings` and *is* stripped by nothing, so it genuinely syncs household-wide, exactly as `app/index.html:4198` claims. That matters in §2.)

Other verifications: `/api/health` live today returns `cronHealthy:true, ageMin:13, due:0, sent:0`, no `queryError`, no `fallback`. `VAX_SCHEDULES` (`app/index.html:8579`) has **12** keys (us, uk, uae, de, au, who, in, ca, ie, nz, sa, sg), not 13. `tools/cap_ios_build.sh:74-79` asserts `aps-environment` on the **archive**, at line 74 hand-signing, *before* the re-signing export at `:99`; the assertion does not cover the shipped binary.

---

## 1. REMINDERS THAT ACTUALLY ARRIVE

### The honest ranking

| Reaches a parent with the app closed | Needs | Verdict |
|---|---|---|
| **.ics into the phone's own calendar** | nothing. No key, no review, no build, no permission prompt | **Build this first** |
| Web push, Android Chrome + desktop | flag flip only (VAPID public at `app/index.html:4515`, `app/firebase-messaging-sw.js` complete, cron alive) | works, but three bugs first |
| Web push, iOS PWA on Home Screen | flag flip only. Web Push over VAPID needs no Apple credential (INFERRED) | same |
| Native push, iOS wrapper | APNs .p8 (founder) + probable rebuild | blocked |
| **`@capacitor/local-notifications` + Time Sensitive** | one TestFlight build + normal review. **No Apple approval, no APNs key, no server** | strongest answer, second |
| Critical Alerts (bypass silent mode) | Apple entitlement form, human review | **assume refusal. Do not apply** |
| Live Activities | Swift widget extension | not an alert. Park |
| Haptics | already shipped (`app/native-bridge.js:38-49`) | wrapper only; no-op on all Apple web surfaces |

`new Notification()` at `app/index.html:8003` is narrower than it looks: illegal constructor on Android Chrome, absent entirely in WKWebView. Desktop and iOS Home-Screen PWA only, and only while foregrounded.

### Build first: the calendar route. And yes, it is the pragmatic unlock.

The pattern already ships. `addApptToCalendar()` (`app/index.html:5407-5413`) emits a real `VALARM`, routed through `saveFile()` (`app/index.html:11282-11288`) which in the wrapper becomes `Filesystem.writeFile` + share sheet (`app/native-bridge.js:53-79`). Its own comment says the thesis out loud (`app/index.html:5406`): *"Add-to-calendar borrows the phone's own reminders... without needing push."* It has never been pointed at medicine.

**Scope: `daily` (set times) only.** `everyX` is anchored to the last logged dose (`medNextDue`, `app/index.html:7739-7741`), so a calendar written Monday is wrong Tuesday, and an .ics cannot be recalled. `asNeeded` returns `null` and has no time at all.

**The event.** One VEVENT per time slot, never one with a multi-time RRULE:

```
UID:cubby-med-<m.id>-<slotIndex>@little-cubby.com
SEQUENCE:<m.ics.seq>
DTSTAMP:<utc now>
DTSTART:20260809T080000          ← floating local time, no Z, no TZID
DTEND:20260809T081500
SUMMARY:Amoxicillin 5ml
DESCRIPTION:From Cubby. Log the dose in the app when you give it.
RRULE:FREQ=DAILY;COUNT=<courseDays>
BEGIN:VALARM TRIGGER:PT0S ACTION:DISPLAY DESCRIPTION:Amoxicillin 5ml END:VALARM
```

Alert at the dose time, not before. The 30-minute lead in `syncReminderIndex` (`app/index.html:4646`) exists only because the cron is 15-minute granular (`wrangler.toml:11`); a calendar has no such constraint.

**Never leaving an orphan, four mechanisms:**

1. **Always bounded.** `COUNT=<days>`, never open-ended. Ask the course length at export; there is no `endsOn` on a medicine today (verified schema at `app/index.html:7821-7826` + `:7882`).
2. **Stable UID + monotonic SEQUENCE.** Re-importing the same UID with a higher SEQUENCE updates the existing entries rather than duplicating them (INFERRED, standard iCalendar; Apple honours it, Google is less reliable). Store `m.ics={seq,days,slots,at}` on the medicine. Additive, rides the existing shared blob, old bundles ignore it.
3. **Schedule change re-exports.** `saveMed` (`app/index.html:7873-7887`) already calls `syncReminderIndex()`; add: if `m.ics` exists and the times changed, bump `seq` and offer the re-export.
4. **A real cancel.** "Take these off my calendar" emits `METHOD:CANCEL` + `STATUS:CANCELLED` + bumped SEQUENCE. `deleteMed` (`app/index.html:7888-7896`) and toggling `active:false` prompt it when `m.ics` exists. Copy must admit this may not stick everywhere.

**Google Calendar drops `VALARM` on import unreliably (INFERRED, long-standing).** Do not present this as cross-platform parity. Strong on iPhone, weak on Android. That asymmetry is itself an argument for local notifications second.

**Copy (house voice, no em-dashes):**

> **Add these times to your calendar**
> Your phone will remind you at each dose time, even when Cubby is closed.
>
> How long is the course?  `3 days` `5 days` `7 days` `10 days` `Other`
>
> One entry per dose time, with an alert at the time. You choose which calendar it goes in.

For `everyX`, one plain line and no button:

> Doses set to every few hours move each time you log one, so a calendar entry would go stale without us being able to fix it. Set times can go in your calendar.

After: `Added, check your calendar 📅` (wrapper: `Course ready 📅`).
On re-export: `Changed a time? Add it again and your phone updates the same entries.`
Cancel: `Removed. If they are still showing, delete them in your Calendar app.`

### How this never becomes non-medicine notification

The chokepoint has to have a shape that cannot express anything else. Not `addToCalendar(title, time)`. This:

```js
function exportDoseCourse(medId, days)   // resolves name/dose/times from state.meds itself
```

Same rule for the local-notifications work later: `scheduleDoseAlert(medId, dueTs)`, with `interruptionLevel` a **constant inside the function, never a parameter**. If the only way to schedule anything is to name a medicine that exists, a growth nudge is a refactor someone must justify, not a quiet decision.

Blocking check: `tools/medalarm_test.js` (32KB, live, edited today) already gates the Reminders copy for truthfulness. Add an assertion that the ICS/notification module is imported in exactly one place and no call site outside the medicine block reaches it.

### Quiet hours and the off switch, as they actually are

- In-app dose alert: quiet hours **soften only**, medium to light (`medAlertHaptic`, `app/index.html:7972-7981`). The rationale at `:7961-7967` is correct and should not be touched.
- Push index: quiet hours **suppress outright** (`app/index.html:4663-4665`). Correct for an unsolicited buzz on a locked phone.
- **Calendar: quiet hours do not apply, and must not pretend to.** The entry is in the parent's calendar and they chose the times. Say nothing about quiet hours on that sheet.
- Off switch: `setMedAlerts(false)` (`app/index.html:7705-7710`) is per-device and already honest. A calendar course is *not* covered by it, so the removal button is the off switch for that channel and must be findable from the medicine sheet, not buried in Reminders.

### Three bugs that must be fixed before `REMINDERS_LIVE` is ever flipped

**(a) `worker.js:369-393` counts a failed send as success.** `maxAt` is computed in the scan loop (`worker.js:359`) and the cursor PATCH at `:386` fires on `maxAt > sentUpTo` regardless of `fcmOk`. If the APNs key is absent, every iOS send 401s, every reminder is dropped forever, and `/api/health` reports `due:N, sent:0, cronHealthy:true`. That is the *identical* shape as `docs/postmortems/2026-07-21-push-cron-silent-403.md`, on the other leg, this time with real parents. Fix: gate the cursor on delivery, add a `failed` counter to `recordCronRun`, make `cronHealthy` read it.

**(b) The queue drains and the user leaves the index.** `syncReminderIndex` writes a 48h window (`app/index.html:4646`), refilled only via `maybeSyncReminders()` on a 10-minute throttle (`app/index.html:4620`), and on drain `nextAt` is **deleted** (`app/index.html:4672-4673`) so the doc leaves the cron's query. A parent who does not open Cubby for two days silently stops getting medicine reminders. No error, no health signal.

**(c) `commitDose` does not refresh the index.** `saveMed` (`:7886`) and `deleteMed` (`:7894`) both call `syncReminderIndex()`. `commitDose` (`app/index.html:7935-7941`) calls only `persist()`. For `everyX`, logging a dose moves every future fire time while written entries keep the old ones for up to 10 minutes. The worker skips entries whose dose already passed (`worker.js:365`) but not ones that moved *later*, so it can push "at 2:00pm" for a dose now at 2:40pm.

**(d) Stop asking for a permission that cannot deliver.** `enablePush()` correctly early-returns (`app/index.html:4580`), but `requestNotif()` (`app/index.html:7944-7946`) still fires `Notification.requestPermission()` from `toggleMedRemind` (`:7870`) and `saveMed` (`:7885`). A parent adding an antibiotic gets an OS dialog, grants it, then reads that reminders are in testing. On Android the permission backs a call that structurally cannot execute.

**(e) The comment on the gate is now false.** `app/index.html:4516-4517` states the cron is 403-ing on every run. Verified false today. Correct it whether or not the flag moves.

---

## 2. VACCINE CARD IMPORT

### Straight verdict

**On-device OCR in 2026 cannot transcribe a handwritten vaccine card unaided, and it does not need to.** Tesseract.js lands at roughly 30-55% on messy handwriting (INFERRED). Apple Vision is better and unquantified. But this is a **matching** problem, not a transcription problem: Cubby already holds the country schedule (`scheduleFor`, `app/index.html:8664`) and the birthday, so for ~20-37 known rows you need a plausible date near a fuzzy name match, constrained to after `b.birth`, before `now()`, near `vxDueDate(v)` (`app/index.html:8709`). That prior resolves D/M vs M/D and lets you reject implausible reads.

**The honest baseline nobody should skip.** `vaxCatchUpAllDone()` (`app/index.html:8781-8787`) already gives one-tap onboarding: every past-due dose marked given at the schedule date with `estimated:true`. The import is not competing with nothing. It competes with one tap, and its value is real dates instead of estimated ones.

**So: ship the confirmation screen free and un-gated first. It is the feature. OCR is an accelerant added second.**

### If it goes to a server, the blunt sentence

> A photograph of a named child's immunisation record, carrying their full name, date of birth, clinic, often a hospital MRN or national ID, batch numbers and a clinician's signature, leaves the parent's phone, crosses to a Cloudflare Worker, and is sent on to a third-party AI vendor for inference.

What the site currently promises, verbatim:

- `privacy/index.html:62` — "Photo editing happens on your device; photos are not sent to any third-party image service."
- `faq/index.html:135` and `faq/index.html:447` — "No. Auto-enhance and background cutout run entirely on your device."
- `privacy/index.html:89-94` — sub-processors are exactly Firebase, Cloudflare, Resend.
- The existing on-device precedent is explicit: `app/index.html:10066-10067` — MediaPipe is self-hosted, *"keeps the no-third-party promise... Nothing uploaded."*

**What would have to change for that to be honest:** rewrite `privacy/index.html:62`; rewrite both FAQ answers (`faq/index.html:135` schema + `:447` prose, which must stay in lockstep); add the vendor to `privacy/index.html:89-94` with a DPA covering no-training and a stated retention window; add a per-use consent screen naming the vendor before the camera opens. Note that OpenAI's own documentation states image inputs are CSAM-scanned and may be retained for manual review **even under Zero Data Retention** (INFERRED from vendor docs), so "the photo is never kept" cannot be promised for any image-input vendor. Cloudflare Workers AI is meaningfully easier because Cloudflare is already named at `privacy/index.html:91`, but it is still a new processing purpose and still needs the policy edit.

### The flow

Entry: `vaxSetupCard` (`app/index.html:8766-8781`) gains a third button next to "Yes, all up to date".

1. **Photo.** Plain `<input type="file" accept="image/*">`. Do **not** route through `openPhotoPrep` (`app/index.html:8996`) first: cropping a document is the wrong gesture and its `maxDim:1200` is too low for OCR.
2. **While it works.** `showLoader` (`app/index.html:1586`) with "Reading the card" / "Matching it to their schedule". **Must have a timeout and an `onerror` path.** The Then & Now bug (`docs/plans/2026-08-03-ux-simplify-audit.md:98-101`) froze the app with a taste already spent because a load had no error path.
3. **The confirmation screen, which is the whole product.** Photo pinned at the top, pinch-zoomable. Under it one row per schedule dose: name, a date field pre-filled from the read or empty, reusing `datePicker` (`app/index.html:1655`). Low-confidence rows show the date greyed with a quiet "check this one". Never red, never a count of problems. Unmatched rows below, under "Not on the card". One primary button: "Save these to the schedule". **A row writes only if the parent leaves a date on it. No automatic write at any confidence.** The app already holds this line for voice (`app/voice-log.js:3-4`).
4. **Failure is not an error state.** If nothing matched, show the same screen with empty dates and the photo pinned, so the parent types from the card without switching apps.
5. **The write.** Patch existing rows, never create new ones. `v.given=true; v.givenAt=<ms>; v.estimated=false; v.source='card'`. Never key off `v.id`: it is regenerated on every schedule rebuild (`applyScheduleCountry`, `app/index.html:8691-8695`). **Never write `v.missed`** — it is the only path to amber (`vxStatus`, `app/index.html:8714`; `vaccineOverdue`, `app/index.html:8721`). **Do not call `addEvent`**: `vaxCatchUpAllDone` (`:8781`) does not, `markVaccine` (`:8825`) does, and twelve backdated entries stamped with today's author is the wrong record.
6. **The photo afterwards. Default: not kept.** Ask once: "Keep the card photo?" / "Everyone in your circle can see it." That is verified true (`firestore.rules:160` — `allow read: if request.auth != null && request.auth.uid in pm()`). If kept, OCR from the full-resolution in-memory image but store at `maxDim:1200, q:0.8` (`downscaleToData`, `app/index.html:9365`): a 1600px card scan can exceed the 990,000-char sync refusal at `app/store-firebase.js:1949-1953` and silently strand on one device.

### Pro gating without charging before delivery

- **Free forever:** schedule, catch-up card, manual marking, and the confirmation screen with the photo pinned and empty dates. `PRO.md:28` and `PRO.md:102` both say "Never paywall safety/basics" and list vaccines as free.
- **Pro:** the automatic read only. Add `vaxcard:2` to `PRO_TASTE` (`app/index.html:4198`). Two, because the first photo is often blurry.
- **Charge on delivery:** `useTaste('vaxcard', ...)` fires inside the **save** handler, when at least one row is actually written. Not on camera open, not on read completion. `refundTaste('vaxcard')` (`app/index.html:4210`) on read failure, no match, or any throw.
- **Never strand:** if tastes are gone, show the Pro sheet **before** the camera opens, with the free door explicit on it: "Or fill it in from the card yourself", landing on the same screen.
- **Pre-launch reality:** `PRO_CFG.checkoutUrl` is `''` (`app/index.html:4180`) and `PRO_LAUNCH='October 2026'` (`app/index.html:4187`). Nobody can buy. Leave it un-gated until `checkoutUrl` is live, or every user hits a wall that leads to a waitlist.
- **One thing the lane missed:** `proTaste` lives in `state.settings` and is *not* stripped by `sharedSettings()` (`app/store-firebase.js:698-702`), so the taste pool is **household-wide**. Two caregivers share the two tries. Size accordingly.

**Effort (INFERRED):** confirmation screen with no ML, 1 to 2 days, highest value per hour in the idea. On-device OCR + matcher, 1 to 2 weeks plus a native build. The matcher cannot be tuned without a corpus of real cards, which cannot ethically be collected from parents. Synthetic cards across the 12 layouts are the only clean option and real accuracy stays unknown until testers use it.

---

## 3. MEDICINES PER SUBJECT

### Schema

```js
m.subject = { kind:'baby',   id:<babyId> }   // stays in app.meds
m.subject = { kind:'member', id:<uid>    }   // new home, never in the blob
```

**Two homes, not one.** `app.meds` is circle-readable by rule (`firestore.rules:112`) and rules cannot inspect array contents, so an adult's private medicine in that array would be hidden by the UI only. The published precedent is `households/{hid}/mhealth/{owner}/cat/{category}` (`firestore.rules:225-239`): read = owner or a uid in `sharedWith`; write = `request.auth.uid == owner && request.auth.uid in pm() && request.resource.data.ownerUid == owner`. **The `{category}` wildcard means a new category needs no rules change**, and the write rule is not owner-role-gated, so a father can own his own doc.

**TRAP: do not add `meds` to `MAT_CATS`.** `window.LL.matClear()` (`app/store-firebase.js:1760-1767`) deletes every `MAT_CATS` doc and is called by `pregClear` and by `executeScopedDelete` (`app/index.html:5039`) when a pregnancy closes, **including after a loss**. Folding meds in would delete a woman's prescriptions at the worst possible moment. Also note `syncMaternal` gates on `p.ownerUid !== uidNow` (`app/store-firebase.js:940`), which is exactly why a father, or a mother after birth, has no mhealth path today. The meds category needs its own sync with owner = `myUid()` always.

### Migration nobody can notice

Read-side only, beside `if(!state.meds)state.meds=[];` at `app/index.html:11223`:

```js
(state.meds||[]).forEach(m=>{ if(!m.subject) m.subject={kind:'baby', id:m.babyId}; });
```

Nothing is written to migrate. `babyId` is dual-written forever, so a caregiver on a stale service-worker bundle keeps dosing normally (this is not politeness, it is required, per the render-perf memory). No existing medicine ever moves to the private home; adult meds are new data only. `normalizeLoadedState` runs from `applyAppBlob` (`app/store-firebase.js:888`) on every snapshot, so the default is idempotent.

### Privacy default

- **Baby subject: visible to the whole circle, always, not a toggle.** The double-dose evidence (`lastDoseLine`, `app/index.html:7914-7918`; the one-question guard in `logDose`) is only protective if both caregivers can see it. Hideable baby medicine rebuilds the double-dose bug.
- **Member subject: private, `sharedWith:[]`, server-enforced by `firestore.rules:226-231`.** Unshared means the circle sees **nothing**: no name, no count, no "1 private medicine" badge. A count is itself a disclosure at 22 weeks.
- **Shared with a partner: visibility, not conscription.** He sees name, dose, schedule, dose history. He gets no reminder and no alert pill. Making him on duty is a separate, explicitly worded opt-in.
- **Push bodies must be generic for member subjects.** `syncReminderIndex` writes literal names into `push.due[].body` (`app/index.html:4649`): *"Time for Sertraline 50mg at 9:00pm"*, rendered on a lock screen. `users/{uid}` is self-only (`firestore.rules:12-14`) so at-rest is fine, the payload is not. "A medicine is due at 9:00pm" is enough.
- **Cheap rules hardening:** add `'personalMeds'` to the `hasAny([...])` list in `appBlobClean()` (`firestore.rules:79`) and to the create branch (`firestore.rules:120`). It cannot inspect `app.meds` contents but it makes the wrong-array bug fail loudly server-side.

### Every downstream reader that must change

| # | Reader | Line | Change |
|---|---|---|---|
| 1 | Home alert pills | `app/index.html:2484` | all babies + my own meds. **Fixes the live twin bug.** Subject label when not the active baby |
| 2 | `dismissMedAlert` | `:7724` | `medById(id)` |
| 3 | `snoozeMedAlert` | `:7728` | `medById(id)` |
| 4 | `renderHomeMeds` | `:7794` | subject sections, one visibility line per section |
| 5 | `openMedSheet` | `:7822` | `medById(id)`; subject chips + privacy row |
| 6 | `saveMed` | `:7873-7887` | route on `subject.kind`; keep writing `babyId` for baby meds |
| 7 | `deleteMed` | `:7889` | route; drop "doses already logged stay in your log" for adult meds (they were never there) |
| 8 | `logDose` | `:7920` | `medById(id)` |
| 9 | **`commitDose`** | **`:7936`** | **the single most dangerous line.** `addEvent` stamps `ev.babyId = state.activeBabyId` unconditionally (`app/index.html:1603`). For a member subject it must **not** call `addEvent` at all. Otherwise the dose is a `/events` doc, circle-readable by `firestore.rules:141`, and the mother-in-law sees the antidepressant. Client filtering cannot undo a published doc |
| 10 | **`lastDose`** | **`:7657`** | reads `babyEvents()`. For a member `everyX` med, `medNextDue` returns `null` (`:7739-7741`) and the medicine sits forever on "Log the first dose to start the schedule" and **never becomes due**. Silent total failure of a real prescription |
| 11 | `checkMedReminders` | `:7986` | same scope as #1 |
| 12 | `renderHealth` default | `:8028` | `(medsForBaby(b.id).length \|\| myMeds().length) ? 'meds' : 'vaccines'` |
| 13 | Illness roll-up | `:8071`, `:8080` | correct for free once #9 holds; broken if #9 is skipped |
| 14 | **`visitSummary`** | `:8204`, `:8218` | **baby only, forever.** `babyMeds()` to `medsForBaby(b.id)` so it can never widen |
| 15 | **`openDoctorReport`** | `:8256` | **baby only, forever.** Same |
| 16 | `syncReminderIndex` | `:4644` | all baby meds + my own; **exclude** meds shared with me; generic bodies for member subjects; the 9am digest titles itself `'Today with '+baby` (`:4659`) and must not fold adult meds in |
| 17 | `executeScopedDelete` | `:5030` | `scope.babies` sets `state.meds=[]`; must not touch `state.personalMeds` |
| 18 | Account deletion | `app/store-firebase.js:1840-1842` | already iterates all `mhealth/{uid}/cat/*`; verify, no change |
| 19 | Rituals `evType:'medicine'` | `:9681`, `:9825`, `:9919` | baby-scoped by construction; must not offer a member subject |
| 20 | `openReminders` copy | `:4526-4540` | add one honest clause on whose medicines this device nudges for |

### The live bug this must fix, not preserve

Alert pills (`app/index.html:2484`) and `checkMedReminders` (`:7986`) both scan `babyMeds()` = active baby only, while `syncReminderIndex` (`:4644`) scans `(state.meds||[])` = all babies. **With twins, the non-active baby's overdue antibiotic produces no pill, no toast and no haptic today.** A dose alert that depends on which tab you last opened is not an alert.

Also, while touching these lines: `${m.dose} ${m.unit}` is interpolated unescaped at `app/index.html:2492` and `:7809`, while `m.name` is escaped. Free-text field, own household, low severity, but both lines are being edited anyway.

---

## 4. THE RANKED PLAN

### SHIP NOW (web deploy from `main`, no key, no review)

**N1. Fix the send-leg silent failure.** `worker.js:369-393`, plus `recordCronRun`. Gate the `sentUpTo`/`nextAt` PATCH on delivery; add `failed` to the counters; make `cronHealthy` read it. Extend `test/push-query.test.js`. **~40 lines.** *Done wrong:* you reproduce `docs/postmortems/2026-07-21-push-cron-silent-403.md` on the other leg, with real parents, and health stays green while every reminder is dropped. This is the prerequisite for anything ever flipping.

**N2. Stop the dead permission prompt.** `requestNotif()` at `app/index.html:7944` gains `if(!REMINDERS_LIVE) return;`. Removes the call effect at `:7870` and `:7885`. **2 lines.** *Done wrong:* nothing breaks, but the honest-copy work at `:4534` stays undercut by behaviour.

**N3. Correct the lying comment.** `app/index.html:4516-4522`. The cron is verified healthy. New text:

> Delivery is NOT live yet. The Worker push cron is healthy again (the missing FIREBASE_SERVICE_ACCOUNT secret was restored 2026-08-07), but a failed FCM send still advances the cursor as if it had arrived, and iOS additionally needs an APNs .p8 the founder has not uploaded. FLIP TO true ONLY once the send leg reports failures AND the APNs key is uploaded.

**5 lines.** *Done wrong:* the next reader thinks the gate is further from opening than it is, or nearer.

**N4. `commitDose` refreshes the index.** `app/index.html:7940`, add `syncReminderIndex();` beside `persist();`. **1 line.** *Done wrong:* a pre-dose push names a dose time that has already moved later. A wrong-time medicine reminder is worse than none.

**N5. Twin alert scope.** `app/index.html:2484` and `:7986` scan all babies; pill and toast carry a subject label when the baby is not active. **~25 lines.** This is a live safety fix and stands alone, independent of everything in §3. *Done wrong:* you merge twins into one list and reintroduce "which twin got the 5ml", which is worse than an extra tap.

**N6. The medicine calendar course.** New `exportDoseCourse(medId, days)` next to `addApptToCalendar` (`app/index.html:5407`), a course-length sheet, a button on `renderMedSheet` (`:7827-7867`) shown only for `pattern.type==='daily'`, `m.ics={seq,days,slots,at}`, a cancel export, and the re-export prompt from `saveMed`/`deleteMed`. **~120 lines, 1 to 2 days.** Copy as written in §1. *Done wrong:* you offer it for `everyX` and hand a parent an alarm that goes stale by Tuesday and cannot be recalled. Or you omit `COUNT` and leave a daily 8am alarm in someone's calendar forever.

**N7. The free vaccine confirmation screen.** Photo pinned above the tappable schedule, empty dates, `datePicker` reuse, patch-on-confirm only. **1 to 2 days.** *Done wrong:* it writes a row the parent did not confirm, and both the catch-up card and the doctor report then say on track for a dose the child never had.

### NEEDS A BUILD (TestFlight + normal App Store review, no Apple approval)

**B1. `@capacitor/local-notifications` with `interruptionLevel:'timeSensitive'`** and the Time Sensitive capability ticked in Xcode. No APNs key, no server, no cron, works on a plane, survives reboot and force-quit, breaks through Sleep Focus at 2am, and is the **only** mechanism that stays correct for `everyX` because `commitDose` can cancel and reschedule the ladder. Budget the **64-pending-request iOS ceiling** explicitly and prune on every launch. On Android take `SCHEDULE_EXACT_ALARM` with the in-app settings hand-off rather than risking a Play-restricted `USE_EXACT_ALARM` declaration. *Done wrong:* the chokepoint takes a `title` parameter and within two quarters it is sending "week 24 starts today".

**B2. On-device OCR** (Apple Vision via a Capacitor plugin; Tesseract.js self-hosted as the web fallback, same lazy-load pattern as `app/vendor/mediapipe`). **1 to 2 weeks.** Two-tier: PWA users get nothing until the web fallback lands. *Done wrong:* it auto-writes at high confidence.

**B3. Calendar plugin**, only if the .ics hand-off proves clumsy on a real device. Buys a silent write and, crucially, the ability to delete stale events. **Ask for write-only calendar access on iOS, never full.**

### NEEDS A YES (founder or Apple)

**Y1. Upload the APNs .p8.** ~5 minutes of console time, recipe at `docs/plans/2026-07-15-native-wrapper-app-store.md:199-203`. **And verify `aps-environment` on the shipped binary**, not the archive: `App.entitlements` says `development`, `tools/cap_ios_build.sh:74` hand-signs with that exact file, and the assertion at `:75-79` runs *before* the re-signing export at `:99`. Run `codesign -d --entitlements :- App.app` on the **exported** app before spending a debugging day.

**Y2. Flip web push per surface** (Android Chrome, desktop, iOS Home-Screen PWA), leaving the wrapper honestly dark. Only after N1, N4 and a fix for the 48h drain at `app/index.html:4646` + `:4672`. Verify one real end-to-end delivery per surface, not an inspection of state.

**Y3. Critical Alerts: do not apply.** Apple restricts approval to clinical and public-safety apps and declines anything merely time-sensitive (INFERRED). Never promise a parent an alarm that overrides silent mode.

### LATER

Live Activities (`timerBanner`, `app/index.html:2478`; contraction timer `:6736`) has real charm and a strong App Store 4.2 argument, but it displays, it does not interrupt. Park it behind the medicine work. `webcal://` subscription feeds: refuse. An obscure-URL unauthenticated feed of a baby's medicine names is a health-data leak, and refresh cadence is unfit for dose timing. "Add to Google Calendar" render URLs: refuse, they put a named baby's medicine into a third-party query string.

---

## 5. WHAT THIS MUST NOT BECOME

**Local notifications are the largest medicine-only policy risk this app has ever carried.** Push at least has a cron and a server between someone's idea and a parent's lock screen. An on-device scheduler has nothing. "Nap due in 20 minutes", "you haven't logged today", "your partner added a photo" each become one function call away and cost nothing.

The guardrails already written down, and what will try to break them:

- `app/index.html:4527` — *"never for feeds, naps or milestones."* The temptation: one more channel because it is free.
- `app/index.html:4641-4643` — *"ONLY medicine is critical enough to push. Two kinds, nothing else ever."* The 9am digest at `:4658-4661` is the one daily-cadence notification in the app and correctly does not fire on days with no medicine (`:4660`). **It must never acquire a second sentence.** That is precisely how "medicine only" becomes "medicine and". Put a comment saying so at the call site.
- `app/index.html:7965-7967` — *"tellable apart, through a pocket or a mattress, from the light tap every button in Cubby gives."* Meanwhile `app/index.html:1582` gives a light tap to **every** toast within a second of a gesture. The ladder is already being diluted. Confirming a logged dose deserves a haptic. Confirming a saved nickname does not.
- **Time Sensitive is a trust asset that spends down.** The parent can revoke it per app in Settings. The first time Cubby marks a milestone time-sensitive they will revoke it, and the 2am antibiotic loses Focus breakthrough forever. The interruption level is a constant inside the chokepoint, never a parameter.
- `firestore.rules:174` — privacy is enforced by rules, not client hiding. An adult medicine in `app.meds` hidden only by UI is the exact failure `mhealth` exists to prevent.
- `privacy/index.html:62` and `faq/index.html:135`/`:447` — the on-device photo promise. The vaccine import will be tempted to break it quietly.
- `PRO.md:28` and `:102` — *"Never paywall safety/basics."* The vaccine confirmation screen is a basic.
- `docs/plans/2026-08-03-ux-simplify-audit.md:90-92` — never spend a taste before value is delivered; always leave a free door.
- **Calendar's own landmine is different and it is disclosure.** Never write a pregnancy-stage or loss-adjacent title into a calendar that may be shared with family. A "12-week scan" on a shared household calendar is a disclosure the parent did not choose. `addApptToCalendar` (`app/index.html:5412`) already puts `a.title` straight into `SUMMARY`. For medicine, keep the title parent-controlled and let them pick the destination calendar.
- The Charter: *if a flow needs explaining, it has already failed.* Subject headings in §3 appear **only** when more than one subject has a medicine. A single baby with no adult meds renders byte-identical to today.

---

## 6. THE FOUNDER'S DECISIONS

**1. The vaccine photo: on-device only, or an AI vendor.**
On-device means a genuinely useful pre-fill on a clean card and near-nothing on a bad photo, with the free confirmation screen carrying the feature either way. A server vision model reaches 85-95% on medical documents but requires rewriting `privacy/index.html:62`, `faq/index.html:135` and `faq/index.html:447`, adding a sub-processor at `privacy/index.html:89-94`, a DPA with no-training, and a per-use consent screen naming the vendor. Cloudflare Workers AI is easier because Cloudflare is already listed, but it is still a new processing purpose and still needs the edit. **Recommendation: on-device only. The free screen is the feature and the policy cost is not worth a pre-fill.**

**2. Spend a TestFlight cycle on local notifications before the App Store submission, or ship the calendar route and wait.**
B1 is the strongest answer in the whole reminder question and it needs one build. If the store submission is on a fixed date, a new plugin jeopardises it. If it is not, this is the highest-value native work available. **Recommendation: calendar first this week regardless, then B1 in the next build.**

**3. Where are the testers actually running Cubby, and does web push get flipped for them?**
If every tester is on the TestFlight wrapper, Y2 reaches nobody this week and the .ics path plus B1 are the only routes that matter. If any are on installed PWAs, Y2 delivers real reminders today for the cost of N1 plus the 48h-drain fix. **This one question collapses half the ranking and I cannot answer it from the repo.**

**4. Do adult medicines get their own private home now, or do medicines stay baby-only?**
§3 as designed is six shippable steps and lands a woman's own prescriptions in a server-enforced private document. Steps 1 and 2 (the `subject` read-side default and the twin alert fix) are pure refactors worth doing regardless. Steps 4 onward are new plumbing. Note the open gap either way: the Health tab is unreachable in the pregnancy shell (`renderPregShell` short-circuits at `app/index.html:1942`), so a woman on iron tablets at 22 weeks has nowhere to put them except pregnancy supplements. **Recommendation: ship steps 1 and 2 now as safety work, hold 4 to 6 until after the reminder channel exists.**