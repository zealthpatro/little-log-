# Pregnancy → Birth → Baby — lifecycle build handoff

> **This is v1 (the build spec) and it is SUPERSEDED: the build is done.** For the current
> state of the pregnancy track ("Mommy To Be", branch `pregnancy-tracker`, rollout runbook,
> next-work queue) read **`PREGNANCY-HANDOFF-V2.md`** instead. Kept for the reusable code
> anchors and patterns.

This doc is **self-contained to read** (a fresh session can start from it cold), but the feature it
describes is **not a standalone module**. It is the front end of **one continuous lifecycle inside
the existing Cubby app**: the same `state`, the same household, the same sync, the same UI shell.

**The vision:** Cubby tracks the whole journey on a single timeline:

```
   pregnancy  ──▶  WELCOMING THE BABY  ──▶  newborn  ──▶  year one  ──▶  toddler
   (week view,      (birth: a warm,         (the existing tracker we already have)
    appts, tools)    celebratory transition,
                     not a new app)
```

Pregnancy "mode" is simply what the app shows **before a baby is born**. Birth is a **transition**
within the same app, not a separate product: the pregnancy you tracked becomes the baby you log.
Nothing is bolted on; we extend the app we have so a family never leaves Cubby from the first
positive test through the toddler years.

**Goal of this build:** add the pregnancy front of that lifecycle and the birth transition. A user
starts a pregnancy from a due date (or last-period date), tracks it week by week, logs
appointments / symptoms / tools, and at birth Cubby **welcomes the baby** by turning that pregnancy
into a baby profile that flows straight into the tracker that already exists.

**Status:** Phase 1 (data) is DONE. Phases 2-5 (the in-app UI + the birth transition) are NOT built.
That is this job.

---

## 0a. This is one app, one lifecycle (read first)
- **No separate codebase, route, or data store.** Everything lives in `app/index.html` + the
  existing `state` and Firestore household blob. Pregnancy is just more `state` (see §3) and more
  sheets/screens in the same `render()`.
- **The home screen adapts to where the family is in the lifecycle:** expecting (no baby yet) →
  pregnancy week view; baby born → the existing baby home. Same shell, different content.
- **Birth is the hinge ("Welcoming the baby").** Phase 5 is not a data chore, it is the emotional
  high point: a warm celebratory moment that carries the pregnancy forward into a baby profile and
  keeps the pregnancy as history. Design it to feel like a milestone, not a form submit.
- **Forward continuity:** once the baby exists, the whole current app (logging, sharing, vaccines,
  growth, keepsakes) already covers newborn → year one → toddler. We are completing the *start* of a
  timeline whose later stages already ship.

## 0. Ground rules (do not break)
- **Free tier only.** No Firebase Storage, no Cloud Functions, no Blaze. Pregnancy data rides in the
  existing Firestore household `app` blob (see §4), exactly like babies/meds. No new infra.
- **No em-dashes** anywhere in user-facing copy (use commas/colons). Project-wide rule.
- **Warm, no-guilt tone.** Calm, supportive, never alarmist or judgemental. Match the existing
  sheets (e.g. the Sleep redesign: friendly tiles, plain language).
- **YMYL safety** (this is health content): every medical/timing claim must trace to the cited
  official source already in `app/pregnancy-data.js`. Never diagnose. Danger-sign UI says **"seek
  care"** / "call your midwife, doctor or emergency number", never "you have X". Show the
  "informational, not medical advice, confirm with your provider" disclaimer anywhere a schedule
  or danger sign appears. Do not invent a medical reviewer.
- **Don't break production.** The app is live and in real use. Change → `node --check` → verify in
  preview → bump the service-worker cache → push.

---

## 1. Where things are
- App is a single-file vanilla-JS PWA at **`app/index.html`** (one global `state`, one `render()`
  that re-renders everything). No framework, no build step.
- Pregnancy **data is already built**: **`app/pregnancy-data.js`** exposes `window.PREG`:
  - `PREG.weeks` — object keyed by week (4-41): `{ week, trimester, size, baby, mum }`
    (`size` = "size of a lime" style comparison; `baby` = development line; `mum` = what mum may feel).
  - `PREG.antenatal` — `{ uk, us, de, uae, generic }`, each `{ label, source, note?, items:[{week,title,note}] }`.
  - `PREG.dangerSigns` — `{ source, note, items:[string] }` (CDC HEAR HER warning signs).
  - `PREG.tri(week)` — returns trimester 1/2/3.
- It is already loaded by the app (it's a sibling script). Confirm the `<script src=".../pregnancy-data.js">`
  tag exists in `app/index.html`; if missing, add it next to `growth-data.js`.
- Spec background: `PREGNANCY.md` (phases + source list to re-check yearly).
- Country detection (reuse for the antenatal default): `detectCountry()` in `app/index.html`
  (around line 2860) returns one of the schedule keys; map it to `PREG.antenatal` (note: it
  returns vaccine-schedule keys `us/uk/uae/de`; fall back to `generic` if no match).

---

## 2. Exact patterns to reuse (with anchors in `app/index.html`)
Line numbers are approximate (the file changes); grep the symbol to confirm.

| Need | Reuse | Anchor |
|---|---|---|
| App state object | `let state = { babies:[], ... }` — add `pregnancy:null` | ~line 648 |
| Re-render everything | `render()` | ~line 838 |
| Home screen body | `renderHome()` (where tiles/cards live) | ~line 1032 |
| Active baby helpers | `activeBaby()`, `babyEvents()` | ~line 726-727 |
| Open a bottom sheet | `openSheet(htmlString, accent)` | ~line 1425 |
| Close a sheet | `closeSheet()` | ~line 1432 |
| Time/date picker (unified, pump-style) | `timeStrip(slot,label)` to render, `getWhen(slot)` to read, `initLogWhen()` to reset | ~line 823-827 |
| Unique id | `uid()` | grep `function uid` |
| Add a log entry | the addEvent pattern: `ev.id=uid(); ev.babyId=state.activeBabyId; ... ; persist(); render()` | ~line 792 |
| Persist + sync | `persist()` (debounced diff push, overridden in store-firebase.js) | call after any `state` mutation |
| Country default | `detectCountry()` | ~line 2860 |
| Avatars/pickers | `cubbyBear(...)` and pickers in `app/cubby-extras.js` | that file |
| HTML-escape user text | `escapeHtml(...)` | grep `function escapeHtml` |

**Sheet pattern (copy an existing one, e.g. the Sleep sheet around line 1642):**
```js
function openKickCounter(){
  openSheet(`<h2>Kick counter</h2><div class="sub">Count baby's movements. Tap each kick.</div>
    ... your markup, buttons call other functions ...`, 'preg');
}
```
Buttons inside sheets call global functions by name (`onclick="saveX()"`). After saving:
mutate `state.pregnancy...`, call `persist()`, then `render()` (or re-open the sheet to refresh it).

---

## 3. Data model — `state.pregnancy`
One pregnancy per household (like the babies array, but typically a single active object). Shape:

```js
state.pregnancy = {
  id,                 // uid()
  dueDate,            // ms epoch (EDD). Either entered directly or computed from lmp.
  lmp,                // ms epoch (last menstrual period) | null
  country,            // antenatal schedule key: 'uk'|'us'|'de'|'uae'|'generic'
  careTeam: [],       // [{id,role,name,phone?}]  role = 'Midwife'|'OB'|'GP'|...
  appts: [],          // [{id,week,title,note,done:false,at?}]  seeded from PREG.antenatal[country]
  symptoms: [],       // [{id,at,kind,note}]   (reuse the events/log style)
  weights: [],        // [{id,at,kg}]          (optional; or fold into symptoms/log)
  bp: [],             // [{id,at,sys,dia}]
  kicks: [],          // [{id,start,end?,count}]  one per counting session
  contractions: [],   // [{id,start,end}]         derive frequency+duration for 5-1-1
  birthPlan: '',      // free text
  bag: [],            // [{id,text,done}] hospital-bag checklist
  bornBabyId: null,   // set when converted to a baby (pregnancy becomes "completed" history)
  createdAt
};
```

**Derived (compute, don't store):**
- Current week from `dueDate`: `40 - round((dueDate - now)/(7*86400000))`, clamp 1-42.
  (If only `lmp`: `week = floor((now - lmp)/(7*86400000))`; `dueDate = lmp + 280 days`.)
- Trimester: `PREG.tri(week)`.
- Week content: `PREG.weeks[week]` (clamp to the 4-41 range that exists).

---

## 4. Make it sync (one place, two functions) — `app/store-firebase.js`
The household `app` blob is what syncs. Register `pregnancy` in BOTH directions:

1. **Serialize** in `appBlobFromState()` (~line 203): add `pregnancy: state.pregnancy || null` to
   the returned object.
2. **Restore** in `applyAppBlob(app)` (~line 213): add `state.pregnancy = app.pregnancy || null;`.
3. (Optional) the legacy-migration reader (~line 147-164) only matters for importing very old
   localStorage data; pregnancy never existed there, so you can skip it.

That is all the persistence work. `persist()` already diff-pushes the blob and real-time listeners
merge remote changes back. Do **not** write Firestore directly from app code.

Also add `pregnancy:null` to the initial `state` literal (~line 648) and to the sign-out/reset
reset (~line 2192) so it clears on logout.

---

## 5. Build phases (each is shippable on its own)

### Phase 2 — Pregnancy mode + week view (start here)
- **Entry point:** when there is no baby yet (or via a "+ Add" menu), offer **"I'm expecting"**.
  A small sheet: due date OR last-period date + country (default `detectCountry()` mapped to a
  schedule key, else `generic`). Compute and store `state.pregnancy`, seed `appts` from
  `PREG.antenatal[country].items` (copy each into `{...item, id:uid(), done:false}` so they're
  editable). `persist(); render()`.
- **Week view (the home when a pregnancy is active and no baby is born yet):**
  - Big "Week N · Trimester T" header + a gentle progress bar (week/40).
  - Three calm cards from `PREG.weeks[week]`: **Size** (`size`), **Baby** (`baby`), **You** (`mum`).
  - A "Next appointment" card (soonest not-`done` appt from `appts`).
  - A quiet "Warning signs" link → danger-signs screen.
  - A "Baby has arrived" button (→ Phase 5).
- **Danger-signs screen:** list `PREG.dangerSigns.items` with `PREG.dangerSigns.note` at top and
  the source link; framed as "seek care", not diagnosis.
- **Acceptance:** create a pregnancy, see the correct week/trimester/content, appts seeded, danger
  signs visible, everything survives reload (synced) and shows on a second device.

### Phase 3 — Logging
- **Appointments:** list `appts` sorted by week; tick `done` (record `at = now()`), edit/reschedule,
  add custom ones. Reuse `timeStrip` for any datetime.
- **Symptoms / weight / blood pressure:** simple log entries appended to the relevant arrays with
  `timeStrip('when')` + `getWhen('when')`. Mirror the existing log-and-render pattern (§2).
- **Care team:** add midwife/OB/GP (name, role, optional phone).
- **Acceptance:** all entries persist + sync; lists read back correctly; no console errors;
  `node --check` clean.

### Phase 4 — Tools
- **Kick counter:** "count to 10" session. Start a session (`{id,start,count:0}`), tap to
  increment, finish at 10 (or stop early) recording `end`. Show recent sessions + elapsed time.
- **Contraction timer:** Start/Stop appends `{id,start,end}`. From the last hour derive average
  **frequency** (start-to-start) and **duration**, and surface gentle **5-1-1** guidance
  ("contractions ~5 min apart, lasting ~1 min, for ~1 hour: time to call"). Informational only.
- **Birth plan + hospital bag:** `birthPlan` free text; `bag` checklist (add/tick/remove). Seed the
  bag with a few sensible defaults but keep all items editable/removable.
- **Acceptance:** counters compute correctly across a session; data persists + syncs.

### Phase 5 — Welcoming the baby (the birth transition — the heart of the lifecycle)
This is the hinge that makes pregnancy and the tracker **one journey**. Treat it as a celebratory
milestone, not a data conversion.
- **"Baby is here" moment:** a warm sheet (congratulatory tone, gentle, no em-dashes) to confirm
  name + birth date/time (default now via `timeStrip`), sex if they want it for growth charts, and
  carry over `country` from the pregnancy. A small celebratory flourish is welcome (e.g. a bear, a
  soft "Welcome to the world" line). Keep it skippable/editable: birth is chaotic.
- **Under the hood:** create a baby with the existing add-baby path (see `saveBaby` / the
  `b={id:uid(), name,...,country}` pattern ~line 1850), set it active, set
  `state.pregnancy.bornBabyId = newId` (keep the pregnancy as **history**, do not delete),
  `persist(); render()`.
- **Continuity, not a hard cut:** offer to carry forward what's natural — the chosen name, the
  country (so vaccines/schedule are right immediately), and optionally a "first photo" into
  keepsakes. The home then becomes the normal baby tracker; the completed pregnancy stays viewable
  as history (e.g. in Settings or the baby's profile, as a "your pregnancy" timeline).
- **Optional welcome keepsake:** a birth/announcement card via the existing photo studio
  (`composeShareCard`) is a natural, shareable celebration of the transition (can be a later add).
- **Acceptance:** "welcoming" creates a real baby that works with every existing feature; the
  pregnancy history is retained and linked; vaccine schedule + growth use the carried country/sex;
  the moment feels warm, not like a form.

---

## 6. UX / copy guidance
- Reuse existing sheet styles and the warm card look; keep new accent class consistent (e.g. `preg`).
- Tiles over forms where possible (the Sleep redesign is the reference for tone and layout).
- Always include the disclaimer near schedules/danger signs:
  "Informational only, not medical advice. Always follow your midwife, doctor or health visitor,
  and confirm your own appointment plan with your provider."
- No em-dashes. No fabricated stats. Keep it gentle.

---

## 7. Dev / verify / ship loop
```bash
node tools/serve.js          # http://localhost:8080/app/  (Google sign-in works on localhost)
# build the feature in app/index.html (+ the two store-firebase.js edits in §4)
node --check app/store-firebase.js && node --check app/cubby-extras.js \
  && node --check app/growth-data.js && node --check app/pregnancy-data.js
# (app/index.html is HTML; sanity-check inline JS by loading the app and watching the console)
# verify in the browser: create a pregnancy, walk every phase you built, reload, check a 2nd device
# IMPORTANT: bump the service-worker cache so clients update:
#   in app/sw.js, increment CACHE = 'little-log-vNN'  (currently v47 -> v48)
git add -A && git commit -m "Pregnancy tracker: <phase>" && git push   # auto-deploys (~1 min)
# verify live: open https://little-cubby.com/app/ in a fresh/incognito window
```
- App assets are service-worker cached, so **you must bump `app/sw.js` `CACHE`** or testers keep old code.
- Don't commit secrets; `tools/serviceAccountKey.json` is gitignored.

## 8. Testing checklist
- [ ] Create via due date AND via last-period date both compute the right week.
- [ ] Week clamps gracefully outside 4-41 (very early / overdue).
- [ ] Appointments seed from the chosen country and are editable; ticking persists.
- [ ] Kick counter and contraction timer compute correctly and survive reload.
- [ ] Everything syncs to a second signed-in device in real time.
- [ ] Birth conversion produces a working baby; pregnancy kept as history; country carried.
- [ ] Danger signs + disclaimer present wherever medical content shows.
- [ ] No em-dashes; no console errors; `node --check` clean; `app/sw.js` cache bumped.

## 9. Paywall note
Pregnancy core (week view, antenatal schedule + reminders, danger signs, basic logging, kick/
contraction tools) is **free** — it is trust/safety. Pro candidates later: PDF antenatal/birth
summary for the doctor, premium birth-plan export, advanced insights. Add to `PAYWALL.md` as built.
