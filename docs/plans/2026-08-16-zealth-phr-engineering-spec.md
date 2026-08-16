# Zealth PHR — engineering specification

**A personal health record for individuals, families and caregivers, with server-enforced consent.**

Audience: Zealth engineering agents. This document is written to be executed, not admired. Every section
ends in acceptance criteria or a schema. Where a decision is still open it is listed in §0.3 rather than
buried as an assumption.

Provenance: this codifies the health and care-circle subsystems of Cubby (`little-log-pwa`, `main` at
`5c833aa`, `app/sw.js` = `little-log-v323`), which has been running the same problem shape — longitudinal
records, multiple subjects, shared custody of a record, a clinician-facing artefact — in production. Cubby
citations are `file:line` against that repo and are evidence, not decoration. **Cubby's mistakes are
included deliberately**, because the corrections are the most valuable thing being transferred.

---

## 0. How to read this

### 0.1 What Zealth is, per the founder's scope

Health tracking and longitudinal data flow, so that **individuals, families and caregivers** can record,
code and visualise health metrics over time, and see the impact of interventions on those metrics.

### 0.2 What this specification is not

Not a diagnosis engine. Not a prediction engine (see §7.4 — this is a hard product rule inherited from
Cubby, not a capability gap). Not an EMR: Zealth is the **patient's** record, which a clinician may be
granted a view of. That distinction decides the entire consent model, so hold it firmly.

### 0.3 Decisions required before Sprint 1

These change the architecture. I have made a recommendation for each and built the spec on it; overturn
any of them and the named section needs rework, not the whole document.

| # | decision | recommendation | affects |
|---|---|---|---|
| D1 | Primary jurisdiction | **India (DPDP Act) first, GDPR-compatible by construction** | §4 entirely |
| D2 | ABDM / health-ID integration | **Design the consent artefact ABDM-shaped, integrate later** | §4.6 |
| D3 | FHIR-native storage vs internal model + FHIR export | **Internal model, FHIR R4 on export** | §3, §9 |
| D4 | Datastore | **Postgres + an API tier. Not client-to-database.** | §1.4, §4.5 |
| D5 | Clinician identity | **Verified registry (NMC/HPR) at onboarding, not self-assert** | §2.3, §4.4 |

**D4 is the one that is not really negotiable and deserves its reasoning up front.** Cubby is a
client-to-Firestore product with no application server. Every invariant it could not express in Firestore
security rules therefore became client-only — including consent. Cubby's own repo records this as its
largest open gap, and the failure is not that the team was careless; it is that *rules cannot express
consent*. Consent needs to evaluate a scope against a time window against a revocation state against an
audit obligation, and write an audit row atomically with the read it authorises. **A declarative rules
language cannot do that. An API tier can.** Do not repeat this. Zealth is an API-tier product on day one.

---

## 1. Identity and the care circle

### 1.1 The unit of membership is a circle; the unit of record is a subject

A **circle** is a durable group of people. A **subject** is a person the circle holds a record for. These
are different objects and the record hangs off the subject, not the circle.

Cubby got this right (`households/{hid}` holds `state.babies`, an array) and it paid off immediately:
twins, and later a second child, needed no membership change. For Zealth the same shape carries a family
where two parents track a diabetic child, and later one of the parents' own hypertension.

### 1.2 Identity is many-to-many from day one. This is the correction that matters most.

Cubby points an account at a circle through `users/{uid}.householdId` — **a single scalar**. One account,
one circle, no switcher. For a baby app that is a defensible simplification. For Zealth it is
disqualifying on the first day of sales:

- a professional carer with four clients
- an adult child managing both parents
- a patient who is also their mother's caregiver
- a clinician, who by definition sees many subjects

Retrofitting is not a schema change. Cubby resolves membership by re-reading one household document
(`pm()`, `firestore.rules:217`), so every rule, every client mirror and every query assumes a single `hid`.

```
person            (id, …)                       -- an authenticated human
subject           (id, …)                       -- a person a record is kept about
circle            (id, name, …)
circle_membership (circle_id, person_id, role, joined_at, ended_at)   -- M:N, with history
subject_of_circle (circle_id, subject_id, added_at, removed_at)       -- M:N, with history
```

A `person` and a `subject` are separate rows even when they are the same human, because a subject can
exist with no account (an infant, an elderly parent who will never log in) and must be able to *gain* one
later without re-keying the record. Link them with `subject.person_id NULL`-able.

**Membership rows are closed, never deleted** (`ended_at`), because §5 requires that historical
attribution survive a person leaving.

### 1.3 Acceptance criteria

- A person can belong to ≥2 circles and switch context without re-authenticating.
- A subject can be in ≥2 circles (a child in two separated parents' circles) with **independent**
  membership and consent state in each.
- Removing a person from a circle preserves every record they authored, still attributed to them (§5.3).
- No query anywhere resolves authority from a single scalar on the person row.

### 1.4 Where authority lives

One table is the authority: `circle_membership`. Every authorisation decision resolves against it and
nothing else. Cubby's bug worth not repeating: it also stores a *display* copy of the role in
`memberInfo.{uid}.role`, which any member may write to their own entry
(`onlyOwnMemberInfo()`, `firestore.rules:159`) and which the family screen renders the Owner badge from
(`app/store-firebase.js:2246`). Nothing escalates — the rules read the authority map — but **a caregiver
can display as Owner to the entire circle.** In a care-team product that is a trust failure.

> **Rule.** Render authority from the authority table. Never from a denormalised copy. If you denormalise
> for performance, the copy is server-written and client-read-only.

---

## 2. Roles

### 2.1 Cubby has two roles. Zealth needs five.

Cubby: `owner` and `caregiver`, and that is the entire vocabulary. Deliberate, and right for it. Zealth's
domain has role shapes Cubby never needed:

| role | scope | writes | notes |
|---|---|---|---|
| **subject** | their own record | everything of their own | an adult patient; the default owner of their own data |
| **guardian** | a subject who cannot consent for themselves | everything for that subject | a parent, a legal guardian. Time-bounded: see §2.2 |
| **caregiver** | a subject, by grant | their own entries only | an adult child, a paid carer, a partner |
| **clinician** | a subject, by consent, **for a period** | annotations only, never edits | **not a circle member.** See §4.4 |
| **delegate** | a subject, by durable power | as configured | for capacity loss. See §2.2 |

**The clinician is not a member of the circle.** This is the single most important role decision in the
document. A clinician who is a member is a permanent read of an entire record. A clinician who holds a
*consent grant* is a scoped, expiring, revocable, audited read. Cubby has no clinician role at all — its
clinician-facing surface is a generated PDF the parent hands over, which is a legitimate design and is
worth keeping as the offline fallback (§9.3), but it is not access control.

### 2.2 Capacity, and the transition nobody designs until it hurts

A chronic-illness product will outlive its subjects' capacity to consent. Two transitions must be
first-class, not admin hacks:

1. **Minor → adult.** At the age of majority the guardian's authority must expire *by default*, and the
   subject must gain their own. The record does not move; the authority does. Guardianship rows therefore
   carry `expires_at` computed from date of birth, and a job that surfaces the transition before it fires.
2. **Adult → incapacity.** A `delegate` grant, created by the subject while they have capacity, that
   activates on a documented trigger. Store the authorising document reference; do not model this as "an
   admin flips a flag".

Both are jurisdiction-shaped (D1). Implement the state machine now, bind the ages and evidentiary
requirements to a config table.

### 2.3 Clinician identity must be verified, not asserted (D5)

A self-asserted "I am a doctor" checkbox in a consent flow is a phishing surface pointed at patients. Bind
clinician accounts to a registry identifier at onboarding (India: NMC / Health Professional Registry),
store the verification evidence and its date, and show the patient *what was verified and when* on the
consent screen. An unverified clinician account may exist but may not be the target of a consent grant.

---

## 3. The record

### 3.1 Five record types, and the discipline of not adding a sixth

```
observation        a measured or reported value at a time      (glucose, BP, weight, mood, steps)
condition          a state that persists over an interval      (T2DM, asthma, pregnancy, an episode)
intervention       something done with intent to change state  (a medication, a therapy, a procedure)
document           an artefact                                 (a lab PDF, a discharge summary, a photo)
note               free text by a human                        (a caregiver's account of a bad night)
```

Everything Zealth tracks is one of these. Resist a sixth: Cubby's `state.events` array holds feeds,
nappies, sleeps, medicines, symptoms, temperatures and visits under one `type` discriminator
(`app/index.html:1509`) and that uniformity is why one windowing implementation, one attribution rule and
one export path serve the whole app. The cost of a new top-level type is paid in every one of those.

### 3.2 The observation, in full

The observation is the load-bearing row of a metrics platform. Specify it completely or pay forever.

```sql
observation (
  id                uuid primary key,
  subject_id        uuid not null,            -- §3.5: never nullable, never inferred
  effective_at      timestamptz not null,     -- when the thing was TRUE
  recorded_at       timestamptz not null,     -- when it entered the system
  code_system       text not null,            -- 'LOINC' | 'SNOMED' | 'ZEALTH' (§3.3)
  code              text not null,
  value_num         numeric,
  value_text        text,
  value_code        text,                     -- for coded answers
  unit_ucum         text,                     -- §3.4. NOT a display string.
  ref_low           numeric,                  -- reference range AS OF the observation
  ref_high          numeric,
  method            text,                     -- 'self-reported' | 'device' | 'lab' | 'clinician'
  device_id         uuid,
  author_person_id  uuid not null,            -- §5.1
  source_document   uuid,                     -- provenance when transcribed from a document
  status            text not null,            -- 'active' | 'amended' | 'entered-in-error'
  amends            uuid,                     -- §5.2: correction chain, never in-place edit
  created_at        timestamptz not null
)
```

Four fields people leave out and regret:

- **`effective_at` vs `recorded_at`.** A parent logs last night's 3am reading at 9am. Every longitudinal
  chart must plot on `effective_at`; every audit and sync must order on `recorded_at`. Cubby conflates
  them into a single `time` and it is the root of its trickiest class of bug.
- **`ref_low`/`ref_high` copied at write time.** Reference ranges are age-, sex- and lab-dependent and they
  *change*. A chart that re-derives "was this in range" from today's ranges rewrites history.
- **`method`.** A self-reported BP and an arterial line are not the same observation and must never share
  a trend line without saying so.
- **`status` + `amends`.** See §5.2.

### 3.3 Coding — the "code" in "code, record and visualise"

| domain | system | notes |
|---|---|---|
| observations, labs | **LOINC** | the only sane answer for measurements |
| conditions, findings, procedures | **SNOMED CT** | India has a national licence; check yours |
| medications | **WHO ATC** + local brand table | RxNorm is US-centric; ATC travels |
| diagnoses for billing/reporting | **ICD-10** (→ ICD-11) | separate from SNOMED, do not conflate |
| units | **UCUM** | §3.4 |

**The rule that makes this survivable: uncoded is a legitimate state.** A user typing "felt dizzy after the
new tablet" must be recordable *now*, coded *later*, and never blocked at entry. Model it:

```
code_system = 'ZEALTH', code = 'uncoded', value_text = <verbatim>, coding_status = 'pending'
```

Then a coding queue (human or assisted) binds it, writing an `amends` row rather than mutating. Products
that demand a code at entry get free-text dumped into the notes field and lose the data entirely.

**Acceptance:** every observation is either bound to an external code system or explicitly marked
`uncoded`. There is no third state. A dashboard reports the uncoded backlog by age.

### 3.4 Units are a patient-safety feature, not a display preference

Store **UCUM** and store the value in the unit it was captured in. Convert at render, never at write.

Cubby's cautionary version: it keeps user unit preferences (`settings.unit` ml/oz, `wUnit` kg/lb,
`tempUnit` C/F) and renders the doctor report in the parent's preference. In a baby app the failure mode is
confusion. In a chronic-illness product, mmol/L vs mg/dL for glucose is a factor of 18 and an insulin dose
error. Make the conversion table a single reviewed module with property-based tests, and **render the unit
next to the number on every clinician-facing surface, always, with no preference that can suppress it.**

### 3.5 The multi-subject safety rule

> **Every read and every write is scoped by `subject_id`. No exceptions. No implicit "current subject" in
> data-layer code.**

Cubby's `babyEvents()` (`app/index.html:1625`) filters `e.babyId === state.activeBabyId` on every read, and
the repo carries a family of bugs from the places that forgot. In a single-subject household those bugs are
invisible; they appear with twins. **You will have the multi-subject case on day one** — that is the whole
point of a family PHR — so the equivalent bug is not latent, it is immediate, and it means showing one
person's glucose under another person's name.

Enforce structurally, not by discipline: no repository method takes an optional subject, the active subject
is never read from ambient state below the controller, and a query without a `subject_id` predicate fails a
lint rule in CI.

**Gate:** seed two subjects in one circle with deliberately interleaved data; assert every screen, export
and derived metric attributes every row to the correct subject. Cubby's equivalent gate exists and is what
caught its twins bugs.

---

## 4. Consent — the part Cubby could not build

This is the centre of the product. Read §0.3 D4 first.

### 4.1 Consent is a record, not a flag

Cubby already models it as a record, which is the right instinct
(`app/index.html:5786`):

```js
{ id, type, scope, label, requestedBy, requestedByName, at, approvals:[uid], status }
```

What it lacks — and what Zealth must have — is that **nothing enforces it**. The consent lives in the
circle-shared blob, so any member's client can write it, and the rules cannot read inside the blob to check
it. Cubby's own repo records this as an open gap.

There is a second, sharper lesson. Cubby requires "both guardians to agree" for erasure, but
`householdGuardians()` returns a single uid in the default household, so `maybeCompleteConsent`
(`app/index.html:5615`) — `gs.every(g => c.approvals.indexOf(g) >= 0)` — **completes on one approval.**

> **A two-party control satisfied by one party is worse than no control, because it reads as one in a
> review.** Assert the arity of every multi-party consent in a test, with the degenerate single-party
> household as an explicit case.

### 4.2 The grant

```sql
consent_grant (
  id              uuid primary key,
  subject_id      uuid not null,         -- whose data
  granted_by      uuid not null,         -- who had authority to grant (subject/guardian/delegate)
  grantee_kind    text not null,         -- 'person' | 'clinician' | 'organisation' | 'export'
  grantee_id      uuid,
  purpose         text not null,         -- §4.3. Bound vocabulary, not free text.
  scope           jsonb not null,        -- §4.3
  effective_from  timestamptz not null,
  expires_at      timestamptz not null,  -- NOT NULL. See below.
  revoked_at      timestamptz,
  revoked_by      uuid,
  basis           text not null,         -- jurisdiction-specific lawful basis (D1)
  evidence        jsonb not null,        -- what the human was shown, and when
  created_at      timestamptz not null
)
```

**`expires_at` is NOT NULL.** A perpetual grant is available only by re-granting. This one constraint
removes the most common real-world failure of health data sharing: the clinician who saw you once in 2021
and can still read your record. If the product needs "ongoing care", model it as a long grant with a
renewal prompt, not as `NULL`.

**`evidence` stores what the human actually saw** — the rendered scope description, the version of the
consent copy, the timestamp. When someone later asks "did she understand what she agreed to", a boolean
cannot answer and a screenshot of today's UI is not evidence of what was shown then.

### 4.3 Scope and purpose

Purpose is a **bound vocabulary**, because "we may use your data to improve our services" is not a purpose
and will not survive DPDP or GDPR:

```
'direct-care' | 'second-opinion' | 'family-visibility' | 'caregiver-support'
| 'research-anonymised' | 'insurance-claim' | 'data-portability'
```

Scope is structured, and must be expressible at three grains:

```json
{
  "record_types": ["observation", "condition", "intervention"],
  "codes":        { "include": ["LOINC:2339-0", "SNOMED:73211009"] },
  "window":       { "from": "2025-01-01", "to": null },
  "exclude_categories": ["mental-health", "sexual-health", "substance-use", "genetic"]
}
```

### 4.4 The doctor grant, end to end

1. Patient (or guardian) initiates. **Never the clinician.** A clinician-initiated request is a separate
   object — `consent_request` — that the patient must affirmatively accept, and it can never auto-grant.
2. The patient sees, in their own language: who (with verified registry id, §2.3), what (rendered from
   `scope`, itemised, not "your health data"), why (`purpose`), and until when.
3. Grant is written; `evidence` captures the rendered text and version.
4. The clinician's every read is authorised **at the API tier** against the grant, and **writes an
   `access_log` row in the same transaction as the read it authorises.** Not after. Not asynchronously. If
   the log write fails, the read fails.
5. The patient has a screen that lists every access: who, when, what they looked at. This is the single
   most trust-building surface in the product and it is nearly free once step 4 is atomic.
6. Revocation is immediate and one tap, needs no reason, and is never negotiated in the UI.
7. Expiry is silent and automatic. Renewal is a fresh decision, not a dark-patterned auto-continue.

**Clinicians annotate; they do not edit.** A clinician's contribution is a new row authored by them (§5.1).
No API path lets a grantee mutate a subject-authored row. This keeps the patient's record theirs, which is
the entire premise of a PHR.

### 4.5 Enforcement: one gate, in one place

```
every read of subject data
  → authorize(actor, subject, record, purpose)
     → is actor the subject?                          → allow, log
     → is actor a live circle membership with role?   → allow per role, log
     → is there a live consent_grant covering it?     → allow, log
     → otherwise deny, log the denial
```

Implement once, in the data-access layer, and make it impossible to reach a record any other way. **Test
that the bypass does not exist**: a static check that no route queries the record tables directly.

Cubby's inheritance here is a warning about *partial* structural guards. Its `appBlobClean()`
(`firestore.rules:152`) is described in the codebase as preventing private maternal data from entering the
shared blob — but it only checks whether the top-level map has a key literally named `pregnancy`,
`mhealth` or `maternalHealth`. The same data under any other key, or nested one level deeper, passes. It is
a guard against a careless refactor, which is genuinely useful, and it is *not* a control. Know which of
yours are which, and never let the second kind be described as the first in a compliance document.

### 4.6 ABDM shape (D2)

Even before integrating, shape the artefact so integration is not a rewrite: consent as a signed artefact
with a defined scope, purpose, expiry and revocation, held by a consent manager the patient controls, with
the data fiduciary obliged to honour revocation. Zealth's `consent_grant` above is deliberately that shape.
The integration then becomes a translation layer, not a redesign.

### 4.7 Acceptance criteria

- No read path exists that does not pass §4.5.
- Access log rows are written in the same transaction as the authorised read; a forced log failure fails
  the read (test this by injecting the failure).
- Revocation takes effect on the next request, with no cache older than the grant check.
- A grant cannot be created with `expires_at` null, in the past, or beyond the jurisdiction's maximum.
- Every multi-party consent asserts its arity, including in a single-party household (§4.1).
- The patient's access-log screen shows every clinician read, and a seeded read appears in it.

---

## 5. Integrity: authorship, correction, provenance

### 5.1 Authorship, correctly

Every row carries `author_person_id`, set **server-side from the authenticated principal** and never from
the request body.

Cubby enforces this at create unconditionally (`firestore.rules:222-223`) and it is one of the strongest
things in that codebase. Two corrections before you copy it:

1. **Its immutability rule has a legacy hole.** The update rule is
   `!('authorId' in resource.data) || request.resource.data.authorId == resource.data.authorId` — so
   immutability holds only once the field *exists*, and an owner can inject an arbitrary author onto any
   pre-authorship row. Cubby's own test asserts this on purpose, for its legacy tail. **You have no legacy
   tail on day one. Make it unconditional and never lose that.**
2. **Cubby's `addEvent` does not set `authorId` at all** (`app/index.html:1737`); the field is attached at
   sync time by the store. So authorship is a property of the synced record, not of the created one. Stamp
   it at write, in the same statement as the insert.

### 5.2 Never edit. Amend.

Health records are corrected, not overwritten. An in-place `UPDATE` on a clinical value destroys the fact
that the record once said something else, which is exactly what an audit needs.

```
status = 'active' | 'amended' | 'entered-in-error'
amends = <id of the row this corrects>
```

A correction inserts a new row with `amends` set and flips the old row to `amended`. A mistake becomes
`entered-in-error` — **it is never deleted**, and it stops counting toward metrics while remaining visible
in an audit view. Charts read `status = 'active'`.

### 5.3 Departure preserves attribution

When a person leaves a circle, close the membership and keep a tombstone sufficient to render their past
contributions. Cubby does exactly this (`formerMemberInfo`, `app/store-firebase.js:2571`) and the reasoning
is sound: the record is the *circle's*, and stripping a departed carer's name from three years of entries
damages the record's usefulness far more than it protects them.

Balance it against erasure rights (§4, D1): the tombstone holds display name and relationship, not contact
details, and an erasure request replaces the display name with a neutral label **without unlinking the
rows**. Cubby's self-deletion path already blanks the name while keeping the tombstone.

### 5.4 Retention and deletion, computed server-side

Cubby's 30-day deletion grace is computed **on the client** (`Date.now() + 30 days`) and the cron simply
honours whatever the field says. A client writing `deleteAfter: now` destroys the record on the next tick,
with no grace at all.

> **If a retention window is a promise you make to a user, compute it on the server and let no client
> supply it.**

Its deletion *ordering*, though, is worth copying verbatim (`worker.js:769-818`): child collections first,
nested levels second, the parent row **last**, and on any partial failure abandon the whole operation
untouched so the next run retries. Deleting the parent first strands children that are unreachable but
still present — and in a permission model that resolves authority from the parent, an orphaned child can
fail *open*.

---

## 6. Longitudinal scale

### 6.1 The record only grows

A chronic patient with a CGM produces ~288 observations a day. At three years that is 315,000 rows for one
metric for one subject. Every naive "render the history" implementation dies, and it dies late — in the
most engaged users, who are the ones you least want to lose.

Cubby hit this at a far smaller scale and its response is the transferable part: render a **window**, keep
the rest reachable, and assert both. Its budget gate (`tools/perf_check.js`) asserts DOM nodes under 8000
and markup under 400KB on a real four-month history, **and** asserts completeness — that every day and
every entry remains reachable (121/121 days, 2520/2520 entries).

> **Copy the completeness assertion, not just the budget.** A windowing bug that silently drops a day is
> far worse than a slow page, and only the completeness half catches it.

### 6.2 Derived metrics need a definition, a version, and a provenance

The single best cautionary tale in the Cubby codebase is `netSleepMs` (`app/index.html:~1626`). Sleep
totals were computed as `end − start`. A long night is rarely unbroken, so a parent logging "7pm to 6am"
was credited with eleven hours whether the baby woke twice or not. **Every sleep total in the app was the
optimistic number — including the one on the doctor report.**

The fix added an optional `wakings` field, absent on every historical entry, in which case the computation
is exactly the old sum. So the metric's meaning silently depends on when the row was written.

For a metrics platform this generalises to three requirements:

1. **A derived metric is a named, versioned definition**, stored, not a function scattered in view code.
2. **It records which inputs were available.** "HbA1c estimated from 14 days of CGM at 78% coverage" is a
   different number from the same estimate at 30% coverage, and the chart must be able to say so.
3. **A definition change is a new version**, and historical charts state which version produced them.

Also inherit the clamp: Cubby clamps at zero so a mistyped 900-minute waking cannot produce negative sleep.
Every derived metric needs its impossible-value handling decided at definition time, not discovered in a
chart.

### 6.3 Acceptance criteria

- 3 years of 5-minute-interval data for one subject renders the default view within budget.
- A completeness assertion proves every observation remains reachable through the UI.
- Every derived metric has a stored definition, a version, and a coverage figure surfaced wherever the
  metric is.

---

## 7. Visualisation, and impact

### 7.1 What a chart of a health metric owes the viewer

- **Plot on `effective_at`**, never `recorded_at`.
- **Show the reference band as it was**, from the stored `ref_low`/`ref_high` (§3.2).
- **Never interpolate across a gap.** A line between a Tuesday reading and a Friday reading asserts two
  days of data that do not exist. Break the line; show the gap.
- **Distinguish `method`.** Self-reported and device-measured points get different marks, always.
- **Never average across a unit boundary or a definition version.**
- **State `n` and coverage.** "Average 7.2 mmol/L" from four readings in a month is a number a clinician
  will act on. Say it is four.

### 7.2 Impact: the differentiator, and the honest version

The founder's ask includes seeing **impact** — did the intervention move the metric. Model it explicitly:

```sql
intervention_effect (
  intervention_id  uuid not null,
  metric_code      text not null,
  baseline_window  tstzrange not null,
  effect_window    tstzrange not null,
  baseline_stat    jsonb,      -- {n, mean, sd, coverage}
  effect_stat      jsonb,
  definition_ver   text not null
)
```

And then be honest about what it can say. This is an **n-of-1 observational** comparison. It is confounded
by regression to the mean, by seasonality, by the fact that people start treatments when they feel worst,
and by adherence you cannot see. The product may say:

> *"Your morning readings averaged 8.4 in the two weeks before, and 7.1 in the four weeks after. That is
> what your log shows. It cannot tell you the tablet caused it."*

It may not say "this medication is working". The difference is not legal caution; it is the difference
between a tool a clinician trusts and one they tell patients to ignore.

### 7.3 Charts are a design-system problem, and one is already solved

Do not let each chart invent its own colours, gaps and type ramp. Cubby's hard-won lesson here is
generalisable and cheap: it enforces a four-value vertical rhythm and a type contract **by measuring the
rendered page**, because none of those bugs were visible in the CSS. Adopt the same posture for charts —
one palette, one axis treatment, one gap rule, asserted by a rendering test.

### 7.4 The refusal to predict — a product rule, inherited deliberately

Cubby refuses to predict where the user cannot act on or verify the prediction
(`app/index.html:3001`). Its wake-window feature is the worked example: it shows a **range from the
parent's own logs** — "has usually slept again between X and Y after waking… Every day is different"
(`app/index.html:3037-3050`) — and deliberately refuses to render it as a countdown. The same rule removed
fertility forecasting.

For Zealth the equivalents are: predicting a flare, forecasting an HbA1c, estimating disease progression.
**A PHR describes what happened. It may show the user their own patterns. It does not tell them what comes
next.** Cross that line and you are a medical device in every jurisdiction that matters, with the
regulatory burden that implies — which may be a fine strategic choice, but it must be a *chosen* one, not
something a feature drifts into.

---

## 8. Alerts and time-sensitive surfaces (the Zealth policy, codified)

Applying the stated policy — Live Activities only where there is a clear start and end plus real-time
progress; not for simple or recurring reminders; compact and expanded states with a primary action; deep
linking; auto-end on completion or window close.

### 8.1 The classification

| surface | qualifies? | why |
|---|---|---|
| **Infusion / dialysis session in progress** | **yes** | clear start, known duration, real progress, action "log completion" |
| **Timed medication window** (take within 30 min) | **yes** | bounded countdown, hard end, "Mark as taken" |
| **Fasting window before a lab** | **yes** | explicit start and end, real countdown |
| **Post-dose observation period** (watch 60 min for reaction) | **yes** — highest clinical value | bounded, and the action is "report a reaction" |
| **Symptom / contraction timing** | **yes**, with §8.3 caveats | ongoing process, real-time |
| **Daily medication reminder** | **no** | recurring. Excluded by the policy itself |
| **Appointment tomorrow** | **no** | a notification |
| **Refill due** | **no** | not time-critical, no progress |

### 8.2 Required behaviours

- Compact: metric or countdown plus state. Expanded: countdown, progress, primary action, secondary link.
- Deep link resolves to the **specific subject and record**, not the app root — and re-authorises on
  arrival (§4.5). A deep link is not a bearer token.
- Auto-end on completion, on window close, and on a `stale_at` deadline so a crashed process cannot leave a
  stale activity on a lock screen forever.
- Every activity is cancellable by the user without completing the action.

### 8.3 The lock-screen privacy rule, which the policy as written does not cover

**A Live Activity is a lock-screen broadcast.** "Dialysis · 2h 14m remaining" or "Contraction · 3 min apart"
is legible to anyone near the phone, with no unlock. For a chronic-illness product this can disclose a
diagnosis to a colleague, a stranger on a train, or a family member the patient has not told.

> **Add to the policy: every Live Activity has a redacted default state. Clinical specificity appears only
> after unlock. The user chooses per-category whether the label is specific or generic, and the default is
> generic.**

Cubby's structural version of this instinct is worth noting: one health category (`mood`) is enforced at
the rules layer as **never shareable at all**, in any circumstance
(`firestore.rules`, mhealth). Zealth's equivalent set — mental health, sexual health, substance use,
genetic — should be structurally excluded from lock-screen surfaces and default-excluded from every consent
scope (§4.3 `exclude_categories`).

### 8.4 The cost, stated plainly

Cubby's wrapper remote-loads the web app (`capacitor.config.json:6`), so today 100% of its UI ships over
the air. Live Activity layouts live in the **signed binary**. Whatever Zealth's shell is, this is likely the
first surface where changing what a user sees requires an app-store round trip. Budget for that release
cadence before committing, and keep the *content* server-driven within a layout that changes rarely.

---

## 9. Export and interoperability

### 9.1 Internal model, FHIR on the boundary (D3)

Map on export, not in storage:

| Zealth | FHIR R4 |
|---|---|
| observation | `Observation` |
| condition | `Condition` (and `Encounter` for episodes) |
| intervention | `MedicationStatement` / `Procedure` / `CarePlan` |
| document | `DocumentReference` |
| consent_grant | `Consent` |
| author + amends chain | `Provenance` |

FHIR-native storage forces every internal query through a model designed for exchange, not for the
time-series reads that dominate this product.

### 9.2 Portability is a user right, not a feature

The user can export their whole record, in a machine-readable form, unilaterally, without asking anyone.
Cubby draws exactly this line and its reasoning is quotable: erasure needs both guardians to agree "because
erasing it takes something away from the other parent", while taking a **copy** does not
(`app/index.html:5771`).

> **Destructive acts need consensus. Non-destructive acts do not.** Encode that asymmetry.

### 9.3 The clinician artefact, and the trap Cubby fell into

Keep a generated, human-readable summary for the offline case — the consultation where nobody is
integrating anything. Cubby's visit summary is well-judged: a one-tap summary of the recent record, "ready
to read out".

**But note what Cubby did with it and do not repeat it.** The report is gated on a Pro entitlement — one
free, then a paywall — and the Pro feature list sells it. A chronic-illness product that copies the shape
without noticing has put a paywall on **the only artefact a clinician ever sees**, which is to say on the
moment of care. Monetise elsewhere.

---

## 10. Gates

### 10.1 The pattern to copy

Cubby's most transferable engineering practice is not architectural. It is that **each gate asserts a rule
and states, in a comment, the bug that caused it to exist** — and that the gates measure the *rendered
result*, not the source. Roughly twenty of them exist, including several that verify their own ability to
fail by reintroducing the original bug and asserting the gate catches it.

### 10.2 The correction: automate them

**Cubby's gates do not block anything.** There is no CI beyond two narrow workflows, no pre-commit hook, no
`scripts` block in `package.json`. They are run by hand, and the discipline that keeps them green is a
sentence in an operations document.

For a regulated product that distinction is the entire safety argument. **Copy the gates; add the CI they
lack.** A control that depends on someone remembering is not a control.

### 10.3 Minimum blocking set for Sprint 1

| gate | asserts |
|---|---|
| `consent_enforcement` | no read path bypasses §4.5; forced log failure fails the read |
| `consent_arity` | multi-party consent cannot complete with one party, incl. single-party households |
| `revocation_latency` | a revoked grant denies on the next request |
| `subject_isolation` | two subjects, interleaved data, every surface attributes correctly |
| `authorship_immutability` | author cannot be set from the request body or changed after write |
| `unit_safety` | property-based conversion tests; no clinician surface renders a bare number |
| `completeness` | every observation reachable through the UI at 3-year scale |
| `metric_definition` | every chart names its definition version and coverage |
| `retention_server_side` | a client-supplied retention window is rejected |
| `deletion_ordering` | children before parents; partial failure leaves the record intact |

Each gate must **prove it can fail**: reintroduce the bug in a fixture and assert the gate catches it. A
gate never seen red is a gate nobody has tested.

---

## 11. Build order

**Sprint 1 — the spine.** M:N identity and circles (§1). Subject-scoped record with the full observation
row (§3.2). Authorship and amend-never-edit (§5.1, §5.2). The single authorisation gate (§4.5) even while
only circle roles exist. Gates: `subject_isolation`, `authorship_immutability`, `consent_enforcement`.

Do not defer the authorisation gate to "when we add doctors". Retrofitting a chokepoint into a codebase
that already reads records directly is the single most expensive thing on this list.

**Sprint 2 — consent.** `consent_grant`, the doctor flow end to end (§4.4), atomic access logging, the
patient's access-log screen, revocation. Gates: `consent_arity`, `revocation_latency`.

**Sprint 3 — coding and units.** Terminology binding with `uncoded` as a first-class state (§3.3), the
coding queue, UCUM and the conversion module (§3.4). Gate: `unit_safety`.

**Sprint 4 — longitudinal.** Windowed rendering with completeness assertions, versioned derived metrics
with coverage (§6). Gates: `completeness`, `metric_definition`.

**Sprint 5 — visualisation and impact.** Charts to §7.1, `intervention_effect` with honest framing (§7.2).

**Sprint 6 — export.** FHIR mapping, unilateral portability, the clinician summary (§9).

**Later, and deliberately scoped separately —** the alerting surfaces of §8. They need a native release
cadence (§8.4) and they are worthless until the record underneath is trustworthy.

---

## Appendix: the Cubby corrections, as a checklist

Things Cubby got wrong that this specification fixes. Hand this to reviewers.

| # | Cubby | Zealth |
|---|---|---|
| 1 | one account, one circle | M:N identity (§1.2) |
| 2 | consent client-only; rules cannot reach it | API-tier enforcement (§4.5) |
| 3 | two-party consent completes on one approval | arity asserted in a gate (§4.1) |
| 4 | author immutability has a legacy hole | unconditional (§5.1) |
| 5 | author attached at sync, not at write | stamped in the insert statement (§5.1) |
| 6 | blob-shape guard checks key names only | described as a guard, never as a control (§4.5) |
| 7 | display role writable by its own holder | authority rendered from the authority table (§1.4) |
| 8 | retention window computed client-side | server-computed (§5.4) |
| 9 | derived metric silently flattered the record, and reached the clinician | versioned definitions with coverage (§6.2) |
| 10 | on-device promise held by absence of code | held by a control and a gate (§8.3, §10) |
| 11 | gates are manual | gates block in CI (§10.2) |
| 12 | clinician artefact behind a paywall | never monetise the moment of care (§9.3) |
| 13 | no clinician role; no audit of access | scoped, expiring, revocable, logged (§2.1, §4.4) |

Things Cubby got right, and this specification keeps: the circle/subject split (§1.1), consent as a record
(§4.1), the destructive-vs-non-destructive asymmetry (§9.2), attribution surviving departure (§5.3),
deletion ordering (§5.4), windowing with completeness (§6.1), the refusal to predict (§7.4), structurally
unshareable categories (§8.3), and gates that state the bug that caused them (§10.1).
