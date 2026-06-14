# Cubby Pregnancy Tracker (build spec)

> **Status (June 2026):** The pregnancy tracker is built, merged into `main` and LIVE on little-cubby.com as the "Expecting" stage of one Cubby (170-country antenatal coverage, opt-in health trackers, kicks, contractions, birth plan, hospital bag, Moments, birth transition, compassionate loss flow); this file remains the original spec + source list. Full current state + go-live plan: HANDOFF.md.

> **SUPERSEDED for current status: see `PREGNANCY-HANDOFF-V2.md`.** The pregnancy product
> (now the "Expecting" stage of Cubby) is fully built and **merged into `main` + live**; v2 owns the
> track: state, rollout runbook and next steps. This file remains as the original spec +
> source list (re-check sources yearly).

Goal: make Cubby **one continuous lifecycle inside the same app** from **day 0 (pregnancy) → welcoming the baby (birth) → year 1 → toddler**, not a separate module. A pregnancy is created with a due date (or last-period date), tracked week by week, and at birth Cubby **welcomes the baby** by turning that pregnancy into a baby profile (the pregnancy is kept as history), flowing straight into the tracker that already exists. Birth is a warm transition within the app, not a new product.

YMYL stance (same as vaccines): official-source summaries, visible "informational, not medical advice", real citations, danger-sign guidance says "seek care", never "diagnose". No fabricated medical reviewer; add a named clinician later if available.

## Phases
- **Phase 1 (done): data foundation** — `app/pregnancy-data.js`:
  - `weeks` 4–41: `{week, trimester, size, baby, mum}` (general guidance + common "size of" comparisons).
  - `antenatal`: schedules for `uk` (NHS), `us` (ACOG), `de` (Mutterschaftsrichtlinien), `uae` (WHO-aligned), `generic` (WHO). Each item `{week, title, note}`, every list editable in-app.
  - `dangerSigns`: CDC HEAR HER urgent maternal warning signs.
- **Phase 2 (done): pregnancy mode** — create a pregnancy (due date or LMP → compute current week), week view (size/baby/mum + trimester progress), danger-signs screen. Reuses `detectCountry()` for the antenatal default.
- **Phase 3 (done): logging** — symptoms, weight, blood pressure, appointments (seeded from the country antenatal schedule, tick off / reschedule / add), care team (midwife/OB/GP). Cloud-synced via the household blob.
- **Phase 4 (done): tools** — kick counter (count to 10, session history), contraction timer (frequency + duration, 5-1-1 guidance), birth plan notes + hospital-bag checklist.
- **Phase 5 (done): birth → baby conversion** — "Baby has arrived" turns the pregnancy into a baby (carries birth date, country, optional sex), keeping the pregnancy as history (`bornBabyId`); everything syncs.

All phases built, verified, and **merged into `main` + live** (Jun 2026). Code lives in the `PREGNANCY` section of `app/index.html`; data in `app/pregnancy-data.js`.

## Data model (planned)
`state.pregnancy` (per household, like babies): `{id, dueDate, lmp?, country, careTeam:[], appts:[{id,week,title,note,done,at}], symptoms:[], kicks:[{start,count,...}], contractions:[{start,end}], birthPlan, bag:[], createdAt}`. Add to `appBlobFromState`/`applyAppBlob` so it syncs. A pregnancy with `bornBabyId` set is "completed".

## Maintenance / sources
Re-check yearly (these change):
- UK NHS antenatal schedule: https://www.nhs.uk/pregnancy/your-pregnancy-care/your-antenatal-appointments/
- US ACOG prenatal care: https://www.acog.org/womens-health/faqs/prenatal-care
- Germany G-BA Mutterschaftsrichtlinien: https://www.g-ba.de/themen/methodenbewertung/ambulant/mutterschaftsrichtlinien/
- UAE MOHAP antenatal: https://mohap.gov.ae/
- WHO antenatal care: https://www.who.int/publications/i/item/9789241549912
- CDC urgent maternal warning signs: https://www.cdc.gov/hearher/maternal-warning-signs/

Keep these in step with any in-app copy, and mirror the "confirm with your provider" disclaimer everywhere a schedule or danger sign appears.

## Paywall note
Free: week-by-week, antenatal schedule + reminders, danger signs, basic logging (it's core/trust). Pro candidates: advanced insights, PDF antenatal/birth summary for the doctor, premium birth-plan export. (Add to PAYWALL.md as built.)
