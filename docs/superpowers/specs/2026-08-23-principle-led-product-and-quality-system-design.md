# Cubby Principle-Led Product and Quality System

**Date:** 23 August 2026  
**Status:** Proposed design for founder review  
**Horizon:** Six-week proof cycle, followed by an explicit scale / iterate / stop decision

## 1. Decision

For the next six weeks, Cubby will stop behaving like a broad feature programme and operate as a focused product experiment.

The beachhead is:

> Households caring for a baby under 12 months, with at least two active caregivers.

The job is:

> Know the baby's current state and complete a reliable caregiver handoff without asking another person what happened.

Trying, pregnancy, memories, content, games, keepsakes, and older-child support remain available. They do not set roadmap priority during this proof cycle unless they directly strengthen activation, retained shared care, trust, or revenue learning.

## 2. Principles translated into operating rules

1. **Problem before solution.** Every new item starts with a repeated observed problem, not an attractive implementation.
2. **Painkillers before vitamins.** Reliability, handoff, medicine, invites, sync, and doctor-ready information outrank delight and breadth.
3. **One complete cake slice.** The owner-to-caregiver shared loop must work end to end on every supported surface.
4. **Evidence before expansion.** New lifecycle stages and adjacent features wait until the core cohort retains.
5. **Write the stop rule first.** Every product bet has a segment, hypothesis, primary metric, guardrails, threshold, duration, owner, and decision date.
6. **One primary metric, hard trust guardrails.** Activity that does not create coordinated care is secondary.
7. **Trust compounds.** Privacy, clear pricing, easy cancellation, consent, and maternal-data boundaries cannot be traded for conversion.
8. **Ship learning, not volume.** A smaller change that resolves an uncertainty beats a larger roadmap item.
9. **Customer noise is roadmap input.** Real support messages, reviews, interviews, retries, and abandonment are reviewed weekly.
10. **Scale, iterate, or stop.** No pilot rolls forward by inertia.

## 3. Measurement model

### 3.1 North-star metric

**Weekly Coordinated Care Households (WCCH)**

A household qualifies in a rolling seven-day period when:

- at least two distinct caregivers are active;
- at least one care event is recorded;
- at least one caregiver views an event created by another caregiver; and
- the household is active on at least three separate days.

This measures Cubby's differentiated value. Total registrations, page views, article visits, and raw event counts are diagnostic metrics, not the north star.

### 3.2 Activation

**Shared-care activation:** a new household completes this sequence within 72 hours:

1. owner creates a baby profile;
2. owner records a care event;
3. owner invites another caregiver;
4. invitee accepts and enters the household;
5. either caregiver records a new event; and
6. the other caregiver views it.

Track step conversion and elapsed time. Do not collapse this into a single opaque `activated=true` property.

### 3.3 Retention and pull

Measure by signup cohort:

- household retention in weeks 1, 2, 4, 6, and 8;
- WCCH retention over the same intervals;
- days active per week;
- active caregivers per retained household;
- share of events viewed by a different caregiver;
- organic caregiver invitations and household referrals;
- return-to-work / nanny handoff retention where identifiable through research;
- willingness to pay and trial-to-paid conversion when Pro is live; and
- Sean Ellis “very disappointed” response among retained target households.

### 3.4 Hard guardrails

Any release or experiment stops when it breaches a defined threshold for:

- cross-household or role-based privacy;
- maternal health and mood isolation;
- save success and duplicate-event rate;
- caregiver sync correctness and latency;
- invite/deep-link completion;
- medicine reminder correctness;
- account deletion and caregiver departure;
- crash-free sessions and uncaught errors;
- accessibility of critical flows;
- core page performance budgets;
- support complaints per active household;
- refunds, involuntary renewal, or cancellation friction; or
- data loss during offline use, reconnect, migration, or concurrent edits.

## 4. Six-week proof cycle

### Week 0: establish truth before changing the product

- Freeze new vitamins and adjacent-market work.
- Publish the beachhead, job, north star, activation definition, and decision owner.
- Create a metric dictionary with event names, properties, exclusions, and ownership.
- Audit current telemetry against the activation sequence and guardrails.
- Establish baseline cohorts from available data; mark unavailable metrics honestly.
- Review the last 50 support messages, reviews, tester notes, and observed failures.
- Resolve public trust contradictions: legal-entity placeholders, stale launch dates, and “no app store” copy.
- Replace the ambiguous “no third-party trackers” claim with the precise promise in section 5: no advertising surveillance, sale, retargeting, or audience enrichment.

**Exit:** the team can calculate each available baseline and list every missing signal.

### Week 1: instrument the shared-care loop

- Instrument each activation step, without recording sensitive health content.
- Record anonymous performance and failure metadata for save, sync, invite, and view acknowledgement.
- Add cohort and role dimensions: owner/caregiver, lifecycle stage, platform, and acquisition source.
- Build one internal activation/retention report; avoid a broad vanity dashboard.
- Add data-quality checks for duplicate, impossible, or missing events.

**Exit:** one test household and one real consenting tester produce a complete, explainable activation timeline.

### Week 2: make the cake slice unbreakable

- Repair the highest-friction point in each activation step.
- Make the first log useful before asking for broad setup.
- Make caregiver invitation visible, comprehensible, resumable, and easy to recover.
- Confirm authorship and sync state without technical language.
- Make offline and reconnect behavior explicit and lossless.
- Reduce homepage scope to the four buying questions: fit, shared use, trust/ease, next action.

**Exit:** five representative households can complete the shared loop without founder assistance.

### Week 3: automate critical journeys

- Create deterministic staging accounts and fixtures.
- Put static validation, unit tests, Firebase rules, and critical browser journeys into CI.
- Cover owner setup, first log, invite acceptance, cross-caregiver visibility, edit/delete permissions, offline/reconnect, and departure/deletion.
- Add accessibility scans and mobile visual snapshots to critical screens.
- Enforce a pull-request runtime budget of eight minutes.

**Exit:** a deliberately broken save, invite, privacy rule, offline queue, and accessible name each fail the correct automated gate.

### Week 4: build the nightly journey lab and safe canaries

- Run the broader role/state/platform matrix nightly.
- Use pairwise generation rather than attempting every mathematical combination.
- Add two-context concurrency tests and large-history fixtures.
- Add failure injection for flaky networks, expired links, rejected uploads, revoked permissions, and retries.
- Run small production canaries only in labelled synthetic households.
- Retain screenshots, traces, console logs, and videos only for failures.

**Exit:** seeded faults are detected, attributed to a user invariant, and reported without touching real family data.

### Week 5: validate the product thesis with people

- Observe at least 10 beachhead households or equivalent qualified sessions.
- Include owners, secondary caregivers, and at least two non-technical caregivers.
- Ask about the last real handoff, not hypothetical feature preference.
- Run the “very disappointed” question only after users have experienced the shared loop.
- Catalogue workarounds, abandonment, trust concerns, and moments of relief.
- Test pricing transparently; do not hide costs, force continuity, or use guilt.

**Exit:** evidence is synthesised into repeated pain, retained value, objections, and willingness-to-pay patterns.

### Week 6: scale, iterate, or stop

Review the six-week cohort with one written decision memo.

**Scale the beachhead** when activation, retention, reliability, and trust thresholds are met and usage is not founder-driven.

**Iterate once** when the core pain is confirmed but one identifiable step prevents retained value. Give the iteration a new threshold and fixed runway.

**Stop or narrow further** when target households do not retain, do not add a caregiver, or do not report meaningful loss if Cubby disappears.

No decision may be “continue and add more features.”

## 5. Automated quality architecture

### 5.0 Product intelligence and privacy boundary

Cubby may use contracted analytics, reliability, and infrastructure processors to improve the product. It will not make a family a marketing asset.

The public promise is:

> No advertising trackers. No sale of family data. No retargeting, lookalike audiences, or health-based advertising. Product analytics are used only to improve Cubby and are stripped of family content.

Prohibited uses and destinations include:

- Meta Pixel, Google Ads audiences, TikTok Pixel, advertising data brokers, and equivalent profiling systems;
- remarketing or retargeting based on Cubby activity;
- lookalike or custom advertising audiences;
- sharing health, pregnancy, child, caregiver, or household behaviour for advertising;
- selling or renting event data;
- sending names, emails, photos, notes, symptoms, medicine names, mood, measurements, or raw care records to analytics; and
- using analytics identifiers across unrelated services.

Permitted processors must be purpose-limited, documented in the privacy policy, covered by appropriate data-processing terms, configured for the chosen data region, and required to honour deletion and retention controls.

All product events pass through a first-party Cubby event gateway. The gateway:

- accepts only allowlisted event names and properties;
- rejects unknown or sensitive fields;
- replaces user and household identifiers with scoped pseudonyms;
- excludes synthetic/test households from product metrics;
- attaches release, platform, role, and experiment context;
- rate-limits abuse and duplicate events;
- forwards approved events to the selected processor; and
- preserves a vendor-exit path by keeping the event contract provider-neutral.

Start with PostHog EU Cloud for product analytics, retention, funnels, cohorts, feature flags, experiments, surveys, and error tracking. Disable autocapture and session replay initially. Add narrowly sampled replay only after a separate privacy review, and never on pregnancy health, medicine, notes, photos, account, invite, or deletion surfaces. Add Sentry only if PostHog error diagnosis proves insufficient; do not install overlapping vendors by default.

### 5.1 Environment strategy

Use three isolated surfaces:

1. **Local/emulator:** deterministic tests for state, calculations, rules, migrations, and browser journeys.
2. **Staging:** a production-shaped Firebase and Cloudflare environment for destructive journeys, notification tests, uploads, concurrency, and load.
3. **Production:** read-only probes plus tiny synthetic canaries. Never stress real infrastructure or touch real households.

Test data must be clearly prefixed, time-limited, excluded from product metrics, and automatically removed.

### 5.2 Test layers

#### Pull-request gate: under eight minutes

- static HTML, schema, sitemap, link, and asset checks;
- unit/property tests for dates, schedules, calculations, reducers, and migrations;
- Firestore and Storage rule suites;
- critical Playwright journeys in Chromium;
- axe accessibility checks;
- mobile visual snapshots for the critical path; and
- Lighthouse/performance budgets for the marketing homepage and app shell.

#### Nightly journey lab: under 45 minutes

- Chromium and WebKit;
- phone and desktop viewports;
- lifecycle, role, subscription, permission, and data-state fixtures;
- offline, reconnect, slow, and failed-network paths;
- two simultaneous caregiver contexts;
- legacy and large-history households;
- invite, deep-link, reminder, photo, export, and deletion paths; and
- native-wrapper smoke where automation is practical.

#### Scheduled staging stress

- ramped concurrent households, not undifferentiated HTTP spam;
- bursts of logs and reconnect flushes;
- simultaneous caregiver writes;
- invite acceptance bursts;
- image upload and retrieval;
- cron/reminder batches;
- large reads and migrations; and
- explicit abort thresholds for errors, latency, cost, and data correctness.

#### Production canaries

- homepage and app-shell availability;
- synthetic sign-in and household load;
- one small create/read/cross-caregiver-view/delete journey;
- service-worker and key static asset availability;
- invite resolution in a synthetic household;
- latest cron heartbeat; and
- alerting on user outcomes, not merely HTTP 200 responses.

### 5.3 Invariant catalogue

Each flow is expressed as a durable user promise. Examples:

- If caregiver B records a bottle, owner A sees exactly one matching event with B's authorship within five seconds.
- If a caregiver loses connectivity after tapping save, the event is either visibly pending or durably stored; it is never silently discarded.
- A removed caregiver cannot read, write, or recover household information using an old link or open session.
- Maternal mood data is never readable by any caregiver under any sharing configuration.
- A medicine reminder fires at most once for the intended household, medicine, and due occurrence.
- Account deletion removes access immediately and completes retained-data deletion within the published window.

Tests may change implementation without changing these promises.

### 5.4 State model

Generate coverage across:

- role: visitor, owner, caregiver, invitee, removed caregiver;
- stage: trying, expecting, newborn, baby, toddler, multiple children;
- platform: Safari/PWA, Chrome/Android, desktop, iOS wrapper;
- network: online, offline, slow, flaky, reconnecting;
- data: empty, normal, large, deleted, legacy;
- permissions: allowed, denied, revoked;
- plan: free, trial, Pro, expired; and
- concurrency: single device, two caregivers, conflicting edits.

Use risk-based pairwise combinations. Run all combinations only for privacy and destructive-account boundaries.

### 5.5 Failure triage

Every failure report includes:

- broken user invariant;
- environment, role, stage, and fixture;
- first failing step;
- expected and observed state;
- network/console trace;
- screenshot or video when visual;
- suspected owning component; and
- whether the failure blocks release.

Flaky tests are defects. Quarantine requires an owner and seven-day expiry; repeated reruns are not a passing strategy.

## 6. Cubby Control Tower

The Control Tower is the founder-facing decision layer. It does not replace PostHog or the test runners; it turns their outputs into a manageable operating view.

Build it as a private Cloudflare-protected admin surface backed by a Worker and D1. Query PostHog and operational endpoints through server-side APIs. Never expose provider secrets or unrestricted household data to the browser.

### 6.1 Today

- current production release and deployment time;
- sign-in, save, sync, invite, reminder, storage, and cron health;
- open P0/P1 incidents and affected synthetic/estimated household counts;
- production canary status and time since last successful shared-care loop;
- newly introduced error groups by release; and
- one explicit release-confidence state: green, amber, or red, with reasons.

### 6.2 Product proof

- acquisition-to-shared-care activation funnel;
- time and conversion at every activation step;
- Weekly Coordinated Care Households;
- week 1/2/4/6/8 cohort retention;
- active caregivers and cross-caregiver views per household;
- beachhead versus non-beachhead retention;
- lifecycle continuation, including pregnancy to baby; and
- free, trial, paid, cancelled, and retained cohorts.

### 6.3 Experiments

Every experiment record contains:

- observed problem and evidence;
- hypothesis and eligible segment;
- control and treatment;
- primary metric, guardrails, and minimum sample;
- start, planned decision, and actual decision dates;
- current sample and result state;
- scale, iterate, stop, or inconclusive decision; and
- owner and written learning.

The Control Tower must flag tests that are underpowered, overdue, missing a kill rule, breaching a guardrail, or left running after a decision.

### 6.4 Problems and incidents

Unify automated errors, support messages, canary failures, test regressions, and manual reports into problem clusters. Each cluster includes:

- affected flow and invariant;
- severity, frequency, and first/last occurrence;
- lifecycle stage, role, platform, and release;
- estimated households affected;
- linked evidence, replay or trace where permitted;
- workaround, owner, status, and target resolution; and
- whether the pattern is a candidate product insight.

### 6.5 Lifecycle and win-backs

Eligible states include:

- account created but no first useful log;
- first log completed but no caregiver invitation;
- invitation sent but not accepted;
- shared-care activation completed but household became quiet;
- pregnancy ended without baby transition;
- trial started without meaningful Pro use; and
- subscription cancelled or expired.

PostHog identifies the cohort; Cubby owns the communication decision and delivery through its existing email/push infrastructure. Every win-back has:

- a user-helping reason, not merely a growth target;
- a holdout control;
- one primary return-to-value metric;
- complaint, opt-out, and notification-volume guardrails;
- frequency and quiet-hour limits;
- no health-content or sensitive-event targeting; and
- an automatic stop date.

### 6.6 Alert policy

- **P0:** privacy exposure, data loss, widespread inability to sign in/save, or destructive-account failure. Immediate alert.
- **P1:** invite, sync, reminder, payment, deletion, or storage failure affecting multiple households. Immediate during waking hours, with escalation if unresolved.
- **P2:** elevated errors, funnel deterioration, experiment guardrail movement, or isolated regressions. Daily digest.
- **Insight:** repeated support or behavioural pattern without an active incident. Weekly product review.

An alert is invalid without severity, affected invariant, evidence, owner, next action, and resolution condition. Alerting on a successful HTTP response alone is not sufficient.

### 6.7 Control Tower non-goals

- recreating PostHog charts or experiment statistics;
- storing family content;
- becoming a general-purpose CRM;
- sending autonomous win-backs without explicit rules and holdouts;
- exposing raw user-level browsing as the default view; and
- rewarding activity volume over retained coordinated care.

## 7. Prioritisation contract

Every proposed item receives a one-page bet record:

- observed problem and evidence;
- affected segment and frequency/intensity;
- current workaround and cost of inaction;
- smallest test;
- primary metric and threshold;
- guardrails;
- duration and sample requirement;
- explicit kill/stop rule;
- decision owner and date;
- opportunity cost; and
- resulting scale / iterate / stop decision.

Items are ordered:

1. privacy or data-loss risk;
2. broken shared-care cake slice;
3. activation and retained coordination;
4. measurement and learning reliability;
5. transparent monetisation learning;
6. evidence-backed adjacent jobs;
7. vitamins and delight.

## 8. Initial product bets

### Bet A: caregiver invitation

**Hypothesis:** making the invitation visible during the first useful session and resumable after interruption will increase 72-hour shared-care activation.

**Primary metric:** invitee joined and shared loop completed within 72 hours.

**Guardrails:** owner first-log completion, support complaints, accidental invitations, privacy confusion.

**Decision:** scale only after a predeclared minimum sample and practically meaningful lift; stop if invitation pressure reduces first-log completion or trust.

### Bet B: reliable handoff view

**Hypothesis:** a concise “while you were away” handoff summarising recent events and authorship will increase cross-caregiver views and retained coordinated households.

**Primary metric:** retained WCCH, supported by handoff-view completion.

**Guardrails:** summary accuracy, stale information, increased page latency, reduced raw-log access.

### Bet C: onboarding subtraction

**Hypothesis:** requesting only the information needed for the first log will reduce time-to-value without reducing profile completeness after seven days.

**Primary metric:** first meaningful log in the initial session.

**Guardrails:** incorrect schedules, missing safety-critical data, invitation completion, seven-day profile completion.

## 9. Website changes that support the proof

- Lead with the shared-care problem and beachhead, not the complete feature inventory.
- Demonstrate the owner/caregiver handoff loop in the first screenful.
- Replace “no app store” with a channel-neutral promise covering web, PWA, and native app.
- Replace “no third-party trackers” with “no advertising trackers; no sale of family data,” and link to a plain-language list of permitted processor purposes and prohibited advertising uses.
- Remove or centralise launch dates so stale promises cannot diverge.
- Resolve the legal-entity and jurisdiction placeholders before broad acquisition.
- Separate core free value from Pro extras without urgency or ambiguity.
- Move secondary feature breadth into dedicated pages.
- Use one primary CTA and measure its progression into the activation sequence.

## 10. Governance and ownership

- **Founder:** owns beachhead, primary metric, trust bar, and scale/kill decision.
- **Product/engineering:** owns activation instrumentation, journey correctness, and release gates.
- **Operations/content:** owns weekly customer-noise review and evidence tagging.
- **Quality system:** automatically blocks P0/P1 invariant failures; no silent override.

Weekly review agenda:

1. one north-star and cohort view;
2. guardrail breaches and escaped defects;
3. five real customer messages or observed sessions;
4. current experiments versus written thresholds;
5. items to stop, not only items to start; and
6. one explicit decision log.

## 11. Success and stop criteria for this programme

The six-week programme succeeds when:

- the activation sequence is measurable end to end;
- critical shared-care invariants block regressions automatically;
- the pull-request gate completes within eight minutes;
- nightly critical-path coverage completes within 45 minutes;
- flaky-test rate remains below 1%;
- synthetic production canaries detect seeded failures within ten minutes;
- the Control Tower identifies every active P0/P1, running experiment, overdue decision, and eligible controlled win-back cohort;
- target-household retention and pull can be evaluated honestly; and
- week six ends with a written scale, iterate, or stop decision.

Redesign the quality system when:

- the pull-request gate regularly exceeds ten minutes;
- flaky tests exceed 2%;
- contributors routinely bypass it;
- tests assert clicks instead of user outcomes; or
- maintaining tests costs more than the critical regressions they prevent.

Stop or narrow the product bet when the beachhead does not retain, does not add a second caregiver, or does not report meaningful loss if Cubby disappears after the fixed runway.

## 12. Explicit non-goals for the six-week cycle

- expanding to new lifecycle stages;
- broad AI assistant development;
- new games or keepsake formats without evidence;
- article-volume growth as a substitute for product retention;
- exhaustive testing of mathematically every state combination;
- production load testing against real families; and
- vanity dashboards without an associated decision.
