# Delta: current → target

Current state: `.telemetry/current-state.yaml` (8 signals, no named events, a hand-run derived funnel).
Target: `.telemetry/tracking-plan.yaml` (18 events: 13 derived, 5 emitted).

**Arithmetic: ADD 7 + CHANGE 6 + KEEP 5 + RENAME 0 = 18.** Every target event appears once below.

## Priority order

The backlog is ordered by what it unblocks, not by size.

1. **Monitoring that runs without a laptop.** The only scheduled report has been dead since
   2026-08-30, blocked by macOS from reading `~/Downloads` and exiting 0. Nothing else in this plan
   matters if nobody sees it. The daily snapshot runs in the Worker cron beside the sign-in canary.
2. **Make pregnancy and trying households visible.** They are invisible today. Stage-aware
   derivation is a reporter change only: no new collection, no label change.
3. **Internal exclusion.** Five of thirteen historical accounts are the founder's. Every rate reported
   so far is contaminated until INTERNAL_UIDS exists.
4. **The four emitted counters.** Only these touch the client.

## Add (not tracked today)

| Event | Source | Why |
|---|---|---|
| `household.stage_entered` | derived | Trying → pregnancy → baby is the product's whole arc and is unmeasured. Replaces the "Added a baby" gate. |
| `care_entry.logged` | derived | Daily totals by type, stage and author role. The primary value action, as a trend rather than a first-time flag. |
| `pregnancy.birth_recorded` | derived | The moment a pregnancy household becomes a baby household in Cubby, which is the retention story for the pregnancy stage. |
| `onboarding.step_reached` | emitted | Setup abandonment leaves no record. Three steps: stage chosen, details entered, invite offered. |
| `invite.sheet_opened` | emitted | Paired with `invite.sent`, tells intent apart from follow-through on the wedge. |
| `pro.sheet_viewed` | emitted | Paired with `pro.waitlist_joined`, tells Pro interest apart from registration. |
| `account.deleted` | emitted (Worker) | Erasure removes every record by design, so a counter at purge time is the only trace of explicit churn. |

## Change (derived today, wrong shape)

These exist as stages in `tools/funnel.js`. All six are baby-only today because they sit behind the
"Added a baby" gate.

| Current (funnel.js) | Target | Change |
|---|---|---|
| "Signed in (household created)" | `household.created` | add `stage`, `acq_source`; exclude internal |
| "Logged something (activated)" | `household.activated` | count trying and pregnancy entries, add `entry_type`, bucket time-to-activate |
| "Came back (day 2+)" | `household.returned` | add `stage` |
| "Sticky (7+ active days)" | `household.retained` | same |
| conversions.joined | `member.joined` | stage-aware; not timed, because joinedAt sits beside names in memberInfo |
| `wedge()` | `household.shared_logging_reached` | add `stage`; keep the strict same-day, two-author definition unchanged |

## Keep (storage unchanged, now named in the plan)

| Current signal | Target event | Notes |
|---|---|---|
| pageStats increment | `visit.landed` | Unchanged. Documented as an event because it is one, and because it decides the privacy label. |
| users.acq | `user.attributed` | Unchanged. |
| users.referredBy | `user.referred` | Unchanged; the code itself is never reported. |
| invites / inviteLinks | `invite.sent` | Unchanged; the address is never reported. |
| waitlist/{uid} | `pro.waitlist_joined` | Unchanged; the email stored for the waitlist's own purpose is never reported. |

## Remove

| Current | Why |
|---|---|
| "Added a baby" as a funnel gate | It fails every trying and pregnancy household by construction. Superseded by `household.stage_entered`. |

## Out of scope, deliberately

- **`console.error` operational tags and the sign-in canary.** Service health, not user behaviour.
  Already monitored through `/api/canary`.
- **Page or screen views inside the app.** Feature-engagement events give better signal. In-app
  navigation is not tracked and should not be.
- **Per-entry events.** `care_entry.logged` is reported as daily totals only. A per-entry stream would
  be a behavioural trail of a family's day, which is the thing this product exists not to keep.
- **Billing events.** `subscription.started` and `subscription.cancelled` join when Lemon Squeezy goes
  live, from its webhook in `workers/pro-billing`, not from the client.

## New infrastructure (as built)

| Piece | Where | Notes |
|---|---|---|
| `workers/funnel/core.mjs` | shared | Pure derivation and the step allowlist. The Worker and `tools/funnel_report.js` both import it. |
| `POST /api/step` | `worker.js` | Same-origin, 512-byte cap, allowlist-only, `STEP_RATE_LIMITER` (30/min/IP). |
| `funnel_steps(day, key, n)` | D1 `GAMES_DB` | Atomic upserts. **D1, not Firestore:** an unauthenticated counter must not be able to burn the product's 20,000 writes a day. |
| `funnel_snapshots(day, ok, reason, reads, attempts, body, at)` | D1 `GAMES_DB` | Daily, rolling 30-day cohort, 15,000-read budget, 3 attempts, failures written with their reason. |
| weekly digest | Worker → Resend → `ALERT_EMAIL` | Mondays. Leads with the snapshot job's own health. |
| `cubbyStep(event, props)` | `app/index.html` | Fire-and-forget, production host only, skipped when `cubby-internal` is set. |
| `account.deleted` | `purgeDeletedHouseholds` | Counted when erasure completes, founder's households excluded. |
| `STEP_RATE_LIMITER` | `wrangler.toml` | namespace 1004. |
| `INTERNAL_UIDS` | Worker secret | **Not set yet.** Until it is, the founder's households count as customers. |

**No firestore.rules change was needed**, because nothing new lives in Firestore.

## Gates, each proven able to fail

| Gate | Assertions | Mutations caught |
|---|---|---|
| `test/funnel-core.test.js` | 43 | 7 of 7, plus 3 of 3 on the whole-base scope |
| `test/funnel-worker.test.js` | 46 | 8 of 8, plus 1 of 1 on the bounded read |
| `tools/funnel_steps_check.js` (browser) | 21 | 6 of 6 |
| `tools/tracking_plan_check.js` | 27 | 4 of 4, and 7 red on the stale plan |

## Migration risk

Low. Nothing is renamed that a dashboard depends on, because no dashboard exists. The one behavioural
change people will notice: rates computed before INTERNAL_UIDS is set will shift once it is, because the
founder's own households stop counting.
