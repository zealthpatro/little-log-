# Cubby Design Repo — flows, breakpoints, expected behavior

Single source of truth for **what the product is supposed to do**, flow by flow, and a living audit of **where reality diverges**. Generated from a full code trace + doc sweep + live-site check on **2026-07-12**.

## Structure

```
design/
├── README.md          ← this file: how to use, audit & monitor
├── GAP-AUDIT.md       ← every expected-vs-actual gap, ranked by severity
├── RULES-REVIEW.md    ← line-by-line review of published firestore.rules
├── RED-TEAM-REVIEW.md ← Product-Board Pod-15 pre-launch security verdict + scorecards
├── firestore.published.rules  ← snapshot of console rules (runtime source of truth)
├── BREAKPOINTS.md     ← all responsive breakpoints (app + marketing)
├── DESIGN-SYSTEM.md   ← the APP's design system: type scale, token groups, the touch/contrast/
                          motion floors with their numbers, the component vocabulary, and what we
                          mean by AI slop. Every number in it is re-derived on every run.
                          READ BEFORE ANY APP UI CHANGE.
                          Enforced by tools/design_doc_check.js
├── MARKETING-SYSTEM.md ← site.css / .homex: tokens, type ladder, fold model, the CSS traps
                          that shipped bugs, and the heading-register rule.
                          READ BEFORE ANY MARKETING SITE CHANGE.
                          Enforced by tools/marketing_type_check.js
├── audit.html         ← open in a browser: dashboard of flow status + gaps
└── flows/
    ├── 01-auth.md            sign-in (Google/Apple/email link) + auth gate
    ├── 02-onboarding.md      first-run, stage chooser, add baby, invite
    ├── 03-logging.md         feed/sleep/nappy/pump/activity, When strip, edit/delete
    ├── 04-health-growth.md   growth, vaccines, milestones, illness, meds, photos
    ├── 05-sharing.md         household, invites, roles, notes, attribution
    ├── 06-pro-paywall.md     gates, tasters, waitlist, billing workers
    ├── 07-pregnancy.md       trying → expecting → birth, privacy, loss flow
    ├── 08-settings-data.md   settings, reminders, export/delete, consent
    ├── 09-offline-sync.md    service workers, Firestore offline, sync engine
    └── 10-marketing.md       funnel home → pricing → /app/, SEO pages, edge worker
```

## How to read a flow spec

Each `flows/*.md` has the same shape:

- **Entry points** — every way a user lands in the flow.
- **Flow diagram** — Mermaid; renders on GitHub and in the dashboard.
- **Steps & interactions** — what the user sees/taps, what state changes, what persists.
- **Break points** — decision forks and failure states (signed-out, offline, free vs Pro, no household, errors).
- **Expected vs actual** — expected behavior (with source doc) against what the code does (with file:line). Status: ✅ matches · ⚠️ partial/drift · ❌ gap.
- **Open items** — the flow's entries from `GAP-AUDIT.md`.

## The audit loop (how to keep this honest)

1. **Every product change PR must touch its flow spec.** If code changes a flow and `design/flows/` doesn't change, the PR description must say why. That one rule keeps the specs alive.
2. **Weekly: open `audit.html`**, walk the open gaps, close what shipped, add what's new. Update the status line at the top of each flow file.
3. **Monthly: re-run the drift checks** (below). Anything that fails becomes a GAP-AUDIT entry.
4. **When a doc and this repo disagree**, this repo wins for *behavior*; `CUBBY-EXPERIENCE-CHARTER.md` wins for *principles*; `design/DESIGN-SYSTEM.md` wins for any *number* about the app's look, because it is the only one a gate re-derives from the code on every run. Retire stale statements from README/HANDOFF instead of letting them contradict.

## Drift checks (cheap, repeatable)

| Check | How | Catches |
|---|---|---|
| Deploy drift | `curl -s https://little-cubby.com/pricing/ \| grep -o '\$[0-9]*/mo'` vs repo `pricing/index.html` | stale production pages (found live on 2026-07-12: prod shows $15/mo, repo says $9/mo) |
| Cron health | `curl -s https://little-cubby.com/api/health` → `cronHealthy:true`, `ageMin < 60` | dead reminder cron |
| Pro config | grep `PRO_CFG` in `app/index.html` — `checkoutUrl` empty = waitlist mode | accidental early billing flip |
| SW version | `CACHE='little-log-vNN'` in `app/sw.js` bumped in the same commit as app changes | users stuck on stale builds |
| Doc staleness | doc's own "last refreshed" date > 30 days behind CHANGELOG head | contradicting handoff docs |
| Smoke/UI tests | `tools/smoke.js`, `tools/uitest.js`, `tools/validate.js` | broken pages/links |

## Coverage boundary — what this audit does NOT establish

Be honest with yourself about these; each is a standing item until closed:

1. **Signed-in app behavior is code-traced, not live-tested.** Nobody logged in and tapped through the flows. Runtime bugs, rendering glitches, and real breakpoint behavior are unverified. Close by: one manual pass per flow spec on a phone, or wiring `tools/uitest.js` into a routine.
2. ~~`firestore.rules` never read~~ **Closed 2026-07-12:** published rules snapshotted (`design/firestore.published.rules`) and reviewed line-by-line (`RULES-REVIEW.md`). Core privacy promises verified enforced; found SEC-3 (invitee role escalation), SEC-4, PRIV-4. Remaining: emulator denial suite (PRIV-3) as executable proof, and re-snapshot whenever console rules change.
3. **Live sweep covered 7 URLs**, not all ~400 pages. The two-build drift (DEP-1) was found this way — assume more until a full-site diff (crawl live vs repo) runs post-deploy.
4. **No visual/breakpoint rendering audit** — BREAKPOINTS.md is from CSS source, not screenshots.
5. **No performance or full WCAG measurement** (charter budgets: LCP <2.5s on 4G, <100ms log action) — only the roadmap's known A1–A3 items are tracked.
6. **Article corpus spot-checked (3 of ~398)** for template correctness only.

## Current state at a glance (2026-07-12)

- **33 tracked findings** in `GAP-AUDIT.md`: **4 P0** (SEC-3 invitee→owner escalation LIVE NOW, SEC-1 portal IDOR, DEP-1 two-build deploy drift, PRIV-1 client-only consent), 10 P1, 19 P2.
- Fix order: SEC-3 first (one-line rules publish, live exposure), then DEP-1 (push branch `site`), SEC-1 before billing flip, L1 verify.
- Pro is **waitlist mode** by design until Aug 2026 (`PRO_CFG.checkoutUrl` empty) — not a bug.
