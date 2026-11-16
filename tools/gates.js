#!/usr/bin/env node
/* Run every gate in this repo, once, with one command.
 *
 * The repo had 24 instruments and 2 of them ran automatically. Nothing required anyone to look at
 * the other 22, so they rotted quietly: a design rule with no blocking check has a half-life of
 * about eight weeks here, and the third-party-tracker gate has been failing against production
 * while five public surfaces promise no third-party trackers.
 *
 * It also fixes a whole class of false PASS. The browser gates defaulted to four different ports
 * (8080, 8099, 8123, none), so running one bare in a shared checkout graded whatever server
 * happened to be listening, which is usually a DIFFERENT tree. This starts one server on a port
 * nothing else is using and passes that URL to every gate explicitly, so a pass is always a pass
 * for THIS working tree.
 *
 *   node tools/gates.js              tree gates: everything that can be judged from this checkout
 *   node tools/gates.js --live       also check production (third-party trackers, shipped claims)
 *   node tools/gates.js --emulator   also run the Firestore rules suites (needs java + firebase-tools)
 *   node tools/gates.js --emulator-only   only the Firestore suites (what CI's emulator job runs)
 *   node tools/gates.js --all
 *   --only=<name> filters the emulator tier too, so --emulator --only=household-guard runs one suite.
 *
 * Exit code is non-zero if any REQUIRED gate fails, so CI and a pre-commit hook can both use it.
 */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dl = require('./gate_downloads');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f) || ARGS.includes('--all');
const EMU_ONLY = ARGS.includes('--emulator-only');
const LIVE = has('--live'), EMU = has('--emulator') || EMU_ONLY;
// CI runs on Linux without the Mac Chrome these gates drive, so it takes the Chrome-free subset.
// That is still 6 gates more than ran automatically before this file existed.
const NO_BROWSER = ARGS.includes('--no-browser');
const ONLY = (ARGS.find((a) => a.startsWith('--only=')) || '').slice(7);
/* --only=a,b runs every gate whose name contains a OR b (the nightly dry-run picks one of each tier). */
const onlyMatch = (name) => ONLY.split(',').filter(Boolean).some((x) => name.includes(x));

// Gates that need a browser get `url`; the runner substitutes the real base URL it started.
const TREE = [
  { name: 'seo',            cmd: ['python3', 'tools/seo_check.py'] },
  { name: 'claude-md',      cmd: ['node', 'tools/claudemd_check.js', '--self-test'] },
  { name: 'hooks',          cmd: ['node', 'tools/hooks_check.js', '--self-test'] },
  { name: 'harness',        cmd: ['node', 'tools/harness_check.js', '--self-test'] },
  { name: 'deploy-excl',    cmd: ['node', 'tools/deploy_exclusion_check.js', '--self-test'] },
  /* The guard that keeps gates out of ~/Downloads, and the helper that sends their files elsewhere. */
  { name: 'downloads-guard', cmd: ['node', 'tools/gates.js', '--self-test-downloads'] },
  { name: 'gate-downloads',  cmd: ['node', 'tools/gate_downloads.js', '--self-test', 'url'] },
  { name: 'preg-tick-race', cmd: ['node', 'test/preg-tick-race.test.js', 'url'] },
  { name: 'two-caregivers', cmd: ['node', 'test/two-caregiver-journey.test.js', 'url'] },
  { name: 'mkt-contrast',   cmd: ['node', 'tools/marketing_contrast_check.js', 'url'] },
  { name: 'type',           cmd: ['node', 'tools/type_check.js', 'url'] },
  /* config/app reaches every phone with no deploy and no review, so the validator in front of it is
     held to a written contract: plain text, known hosts, locked safety widgets, nothing dropped. */
  { name: 'config',         cmd: ['node', 'tools/config_check.js', '--self-test'] },
  /* The alert pills are one component now, and their buttons are named actions run by one listener.
     The contract (escaped text, ids as data, a closed registry) is held statically here... */
  { name: 'alert-pill',     cmd: ['node', 'tools/alert_pill_check.js', '--self-test'] },
  /* The second component, the icon-title-subtitle row, held the same way; it also ratchets the
     hand-written .set-item rows that are left, so they can only move onto it. */
  { name: 'set-item',       cmd: ['node', 'tools/set_item_check.js', '--self-test'] },
  /* ...and the dose pill's ways out are tapped for real here. It was orphaned until the AlertPill
     migration: the only test that taps In 15 min and Not now on the pill, and nothing ran it. With the
     listener broken it fails 12 checks; that was watched on 2026-10-27 before it was wired. It reads the
     dose pill, not any pill: the month card sits beside it 89 days a year. It cannot judge a missed
     "set times" slot in the four minutes around midnight, and fails there rather than guess. */
  { name: 'medalarm',       cmd: ['node', 'tools/medalarm_test.js', 'url'] },
  { name: 'grid',           cmd: ['node', 'tools/grid_check.js'] },
  { name: 'type-scale',     cmd: ['node', 'tools/type_scale_check.js'] },
  /* design-doc checks design/DESIGN-SYSTEM.md against the code in both directions, which is the
     only thing keeping that file from turning into decoration. It was held back when it landed
     because it matched sentences and the radius consolidation broke it by CORRECTING the prose it
     was matching; it now reads token-keyed table rows and takes the list of tokens from :root, so
     rewording is free and a dropped row is a failure. It runs first of the design gates, because
     when it and one of them both go red, the one below is usually the cause and this is the
     symptom. */
  { name: 'design-doc',      cmd: ['node', 'tools/design_doc_check.js', 'url'] },
  { name: 'component-dupe',  cmd: ['node', 'tools/component_dupe_check.js', 'url'] },
  { name: 'csub',           cmd: ['node', 'tools/csub_check.js', 'url'] },
  { name: 'touch-target',    cmd: ['node', 'tools/touch_target_check.js', 'url'] },
  { name: 'contrast',        cmd: ['node', 'tools/contrast_check.js', 'url'] },
  { name: 'motion',          cmd: ['node', 'tools/motion_check.js', 'url'] },
  { name: 'surface-token',   cmd: ['node', 'tools/surface_token_check.js', 'url'] },
  { name: 'shortcuts',       cmd: ['node', 'tools/shortcuts_check.js', 'url'] },
  { name: 'ask-emergency',   cmd: ['node', 'tools/ask_emergency_check.js', 'url'] },
  { name: 'temp-units',      cmd: ['node', 'tools/temp_units_fever_check.js', 'url'] },
  { name: 'illness-dose',    cmd: ['node', 'tools/illness_dose_integrity_check.js', 'url'] },
  { name: 'preg-deeplink',   cmd: ['node', 'tools/preg_deeplink_lmp_check.js', 'url'] },
  { name: 'preg-week',       cmd: ['node', 'tools/preg_week_rounding_check.js', 'url'] },
  { name: 'caregiver-write', cmd: ['node', 'tools/caregiver_write_check.js', 'url'] },
  { name: 'caregiver-read',  cmd: ['node', 'tools/caregiver_read_check.js', 'url'] },
  { name: 'loss-keepsake',   cmd: ['node', 'tools/loss_keepsake_check.js', 'url'] },
  { name: 'teach',          cmd: ['node', 'tools/teach_gate.js'] },
  { name: 'perf',           cmd: ['node', 'tools/perf_check.js', 'url'] },
  { name: 'home-truth',     cmd: ['node', 'tools/home_truth_check.js', 'url'] },
  { name: 'report-truth',   cmd: ['node', 'tools/report_truth_check.js', 'url'] },
  { name: 'info-dot',       cmd: ['node', 'tools/info_dot_check.js', 'url'] },
  { name: 'flow-walk',      cmd: ['node', 'tools/flow_walk.js', 'url'] },
  { name: 'sleep-timer',    cmd: ['node', 'tools/sleep_timer_check.js', 'url'] },
  { name: 'preg-safety',    cmd: ['node', 'tools/preg_safety_check.js', 'url'] },
  { name: 'illness-report', cmd: ['node', 'tools/illness_report_check.js', 'url'] },
  { name: 'ritual-flow',    cmd: ['node', 'tools/ritual_flow_check.js', 'url'] },
  { name: 'quality',        cmd: ['node', 'tools/quality_check.js', 'url'] },
  { name: 'undo-away',      cmd: ['node', 'tools/undo_away_check.js', 'url'] },
  { name: 'birth-weight',   cmd: ['node', 'tools/birth_weight_check.js', 'url'] },
  { name: 'nappy-note',      cmd: ['node', 'tools/nappy_note_check.js', 'url'] },
  { name: 'poster-beat',     cmd: ['node', 'tools/poster_second_beat_check.js', 'url'] },
  { name: 'vax-cal-row',     cmd: ['node', 'tools/vax_cal_row_check.js', 'url'] },
  { name: 'reminders-row',   cmd: ['node', 'tools/reminders_row_check.js', 'url'] },
  { name: 'wake-window',     cmd: ['node', 'tools/wake_window_voice_check.js', 'url'] },
  { name: 'fever-net',       cmd: ['node', 'tools/fever_safety_net_check.js', 'url'] },
  { name: 'family-entry',    cmd: ['node', 'tools/family_entry_mode_check.js', 'url'] },
  { name: 'first-entry',     cmd: ['node', 'tools/first_entry_line_check.js', 'url'] },
  { name: 'quick-minweek',   cmd: ['node', 'tools/quick_minweek_check.js', 'url'] },
  { name: 'preg-bp-row',     cmd: ['node', 'tools/preg_bp_row_check.js', 'url'] },
  { name: 'cycle-median',    cmd: ['node', 'tools/cycle_median_check.js', 'url'] },
  { name: 'preg-weeks-cal',  cmd: ['node', 'tools/preg_weeks_cal_check.js', 'url'] },
  { name: 'timer-banner',    cmd: ['node', 'tools/timer_banner_tap_check.js', 'url'] },
  { name: 'jaundice',        cmd: ['node', 'tools/jaundice_symptom_check.js', 'url'] },
  { name: 'relative-when',   cmd: ['node', 'tools/relative_when_check.js', 'url'] },
  { name: 'gest-age',        cmd: ['node', 'tools/gest_age_at_birth_check.js', 'url'] },
  { name: 'night-home',      cmd: ['node', 'tools/night_home_check.js', 'url'] },
  { name: 'yesterday-card',  cmd: ['node', 'tools/yesterday_card_check.js', 'url'] },
  { name: 'head-circ',       cmd: ['node', 'tools/head_circ_check.js', 'url'] },
  { name: 'preg-archive',    cmd: ['node', 'tools/preg_archive_check.js', 'url'] },
  { name: 'trying-survivor', cmd: ['node', 'tools/trying_survivor_check.js', 'url'] },
  { name: 'appt-time',       cmd: ['node', 'tools/appt_time_place_check.js', 'url'] },
  { name: 'kick-baseline',   cmd: ['node', 'tools/kick_baseline_check.js', 'url'] },
  { name: 'birthplan',       cmd: ['node', 'tools/birthplan_summary_check.js', 'url'] },
  { name: 'nappy-colour',    cmd: ['node', 'tools/nappy_colour_check.js', 'url'] },
  { name: 'med-limits',      cmd: ['node', 'tools/med_limits_check.js', 'url'] },
  { name: 'things-to-ask',   cmd: ['node', 'tools/things_to_ask_check.js', 'url'] },
  { name: 'pump-stash',      cmd: ['node', 'tools/pump_stash_check.js', 'url'] },
  { name: 'solids',          cmd: ['node', 'tools/solids_structured_check.js', 'url'] },
  { name: 'csv-import',      cmd: ['node', 'tools/csv_import_check.js', 'url'] },
  { name: 'manifest-shots',  cmd: ['node', 'tools/manifest_shots_check.js', 'url'] },
  { name: 'precon-shared',   cmd: ['node', 'tools/precon_shared_check.js', 'url'] },
  { name: 'preg-proof',      cmd: ['node', 'tools/preg_proof_line_check.js', 'url'] },
  { name: 'ask-box',         cmd: ['node', 'tools/ask_box_check.js', 'url'] },
  { name: 'illness-start',  cmd: ['node', 'tools/illness_start_check.js', 'url'] },
  { name: 'appt-ics',       cmd: ['node', 'tools/appt_ics_check.js', 'url'] },
  { name: 'feed-tile',      cmd: ['node', 'tools/feed_tile_guard_check.js', 'url'] },
  { name: 'getstarted',     cmd: ['node', 'tools/getstarted_author_check.js', 'url'] },
  { name: 'notes-unseen',   cmd: ['node', 'tools/notes_unseen_check.js', 'url'] },
  { name: 'preg-canwrite',  cmd: ['node', 'tools/preg_log_canwrite_check.js', 'url'] },
  /* Who is pregnant comes from the journey's ownerUid, never a relationship label. Plants the old
     label rule into the page on every run and fails if that stops going red. */
  { name: 'carrier-view',   cmd: ['node', 'tools/carrier_view_check.js', 'url'] },
  { name: 'preg-session',   cmd: ['node', 'tools/preg_session_resume_check.js', 'url'] },
  { name: 'support-reach',  cmd: ['node', 'tools/support_reach_check.js', 'url'] },
  { name: 'vax-calendar',   cmd: ['node', 'tools/vax_calendar_check.js', 'url'] },
  { name: 'homelogs',       cmd: ['node', 'tools/homelogs_gate.js', 'url'] },
  { name: 'offline',        cmd: ['node', 'tools/offline_gate.js', 'url'] },
  { name: 'sitesw',         cmd: ['node', 'tools/sitesw_gate.js', 'url'] },
  { name: 'stack',          cmd: ['node', 'tools/stack_check.js', 'url'] },
  { name: 'pad',            cmd: ['node', 'tools/pad_audit.js', 'url'] },
  { name: 'blob-clobber',   cmd: ['node', 'test/blob-clobber.test.js'] },
  { name: 'blob-merge',     cmd: ['node', 'test/blob-merge.test.js'] },     // a pending edit survives a snapshot: the real merge, hold and re-baseline
  { name: 'quick-close',    cmd: ['node', 'test/quick-close.test.js'] },    // an entry logged just before a reload or close is kept: flush on hide, outbox, guarded replay
  { name: 'dose-ticket',    cmd: ['node', 'test/dose-ticket.test.js'] },
  /* dose-ticket proves a ticket cannot be forged; this proves only a current owner or caregiver can
     get or redeem one. Drives the real worker.js; --self-test re-breaks a temp copy of it. */
  { name: 'dose-membership', cmd: ['node', 'test/dose-membership.test.js', '--self-test'] },
  /* Every limiter call goes through rateLimited(), which fails open but never silently: a throw, a
     malformed reply and a denial are each logged. Production went months without one 429. */
  { name: 'ratelimit',      cmd: ['node', 'test/ratelimit.test.js', '--self-test'] },
  { name: 'push-delivery',  cmd: ['node', 'test/push-delivery.test.js'] },
  { name: 'signin-canary',  cmd: ['node', 'test/signin-canary.test.js'] },
  /* The funnel: derivation, Worker, client, and the plan they all answer to. Each proven red. */
  { name: 'funnel-core',    cmd: ['node', 'test/funnel-core.test.js'] },
  { name: 'funnel-worker',  cmd: ['node', 'test/funnel-worker.test.js'] },
  { name: 'native-deeplink', cmd: ['node', 'test/native-deeplink.test.js'] },   // the native wrapper keeps a token invite link
  { name: 'sender-name', cmd: ['node', 'test/sender-name.test.js'] },   // a sender's own name never reads as an address or a claim
  { name: 'funnel-steps',   cmd: ['node', 'tools/funnel_steps_check.js', 'url'] },
  /* The plan, both allowlists and the App Store answers agree (admin spec §14 tracking-plan, extended).
     --self-test stages every failure it knows in temp copies (about 2s) before judging this tree. */
  { name: 'tracking-plan',  cmd: ['node', 'tools/tracking_plan_check.js', '--self-test'] },
  /* Usage events, phase 2 of docs/superpowers/specs/2026-11-13-admin-dashboard-design.md. ingest(): what
     /api/usage may store, over real SQLite with a pinned day and hour, and its D1 rows a day under any
     traffic. route: the route around it (body cap, limiter keys, membership, the full-day memory, log lines),
     through the real worker.js. erasure: account and household purges, the orphan sweep and retention, with
     a 100-day steady state through the real cron. Each -mut gate is that file's --self-test: an unaltered
     temp copy must pass, then every mutant must turn its own named check red. */
  { name: 'usage-ingest',   cmd: ['node', 'test/usage-ingest.test.js'] },
  { name: 'usage-ingest-mut', cmd: ['node', 'test/usage-ingest.test.js', '--self-test'] },
  { name: 'usage-route',    cmd: ['node', 'test/usage-route.test.js'] },
  { name: 'usage-route-mut', cmd: ['node', 'test/usage-route.test.js', '--self-test'] },
  { name: 'usage-erasure',  cmd: ['node', 'test/usage-erasure.test.js'] },
  { name: 'usage-erasure-mut', cmd: ['node', 'test/usage-erasure.test.js', '--self-test'] },
  { name: 'funnel-report',  cmd: ['node', 'tools/funnel_report.js', '--self-test'] },
  { name: 'signin-email',   cmd: ['node', 'test/signin-email.test.js', '--self-test'] },
  { name: 'signin-flow',    cmd: ['node', 'test/signin-flow.test.js', '--self-test'] },
  { name: 'signin-boot',    cmd: ['node', 'test/signin-boot.test.js', '--self-test'] },
  { name: 'push-caps',      cmd: ['node', 'test/push-caps.test.js'] },
  { name: 'duedate-cycle',  cmd: ['node', 'test/duedate-cycle.test.js', 'url'] },
  { name: 'fab-quicklog',   cmd: ['node', 'test/fab-quicklog.test.js', 'url'] },
  /* The November 2026 security fixes. Each was watched failing on the live code (1a6df125) first.
     page-stats: a stranger looping 404s must make zero Firestore writes and stay under the D1 cap. */
  { name: 'page-stats',     cmd: ['node', 'test/page-stats.test.js'] },
  { name: 'page-stats-tool', cmd: ['node', 'tools/page_stats.js', '--self-test'] },
  /* purge-guard: the purge cron never erases a household that still has people in it. */
  { name: 'purge-guard',    cmd: ['node', 'test/purge-guard.test.js'] },
  /* signin-budget: a reissue never resets an address's guesses, and every limiter keys an IPv6 /64. */
  { name: 'signin-budget',  cmd: ['node', 'test/signin-code-budget.test.js'] },
  { name: 'worker-routes',  cmd: ['node', 'test/worker-routes.test.js'] },   // invite mail caps, newsletter consent, game ceilings, no throws
  /* xss-sink: markup in anything a circle member can write is drawn as text, in every view. It runs
     xss_leaf_check.js as its last section (each leaf field, each sink, mutants included). */
  /* Cubby Ops, the admin Worker (workers/admin), phase 1 of docs/superpowers/specs/2026-11-13-admin-dashboard-design.md.
     Each runs its --self-test: every rule is broken in a temp copy and the suite must go red on it. */
  { name: 'admin-access',     cmd: ['node', 'test/admin-access.test.js', '--self-test'] },      // Access JWT re-checked, fail closed, headers on every answer (S1-S8)
  { name: 'admin-access-log', cmd: ['node', 'test/admin-access-log.test.js', '--self-test'] },  // logged before shown, hash chain, fixed vocabulary, digest head (S16-S19)
  { name: 'admin-no-content', cmd: ['node', 'test/admin-no-content.test.js', '--self-test'] },  // masked reads, no log content anywhere, private pregnancy, read budget
  { name: 'admin-hold',       cmd: ['node', 'test/admin-hold.test.js', '--self-test'] },        // the loss-hold reader fails closed (S12)
  { name: 'dir-erasure',      cmd: ['node', 'test/admin-dir-erasure.test.js', '--self-test'] }, // gone from Auth = gone from the admin next tick; failure is never "gone"
  { name: 'admin-screens',    cmd: ['node', 'test/admin-screens.test.js', '--self-test'] },     // formula-safe CSV, the three system checks, "Waiting", two-people = digest, own accounts hidden
  /* No personal email address in any tracked file (admin spec S34). The repo is public. */
  { name: 'no-personal-address', cmd: ['node', 'tools/address_check.js', '--self-test'] },
  { name: 'admin-live-self', cmd: ['node', 'tools/admin_live_check.js', '--self-test'] },   // admin(live) can go red: a page, a missing header, a stray redirect, a 404
  { name: 'push-daily',       cmd: ['node', 'test/push-daily.test.js', '--self-test'] },                       // the day's reminders tally the admin reads; not on the public /api/health
  /* The admin's pages in Chrome: a hostile name stays text, nothing loads from another origin, 44px targets,
     no sideways scroll at 390 or 320. --self-test also breaks escaping, wrapping and the fonts in a temp copy. */
  { name: 'admin-ui',         cmd: ['node', 'test/admin-ui.test.js', 'url', '--self-test'] },
  { name: 'xss-sink',       cmd: ['node', 'tools/xss_sink_check.js', 'url'] },
  { name: 'xss-leaf-static', cmd: ['node', 'tools/xss_leaf_check.js', '--static-only'] },
  /* No tab scrolls sideways at 320px, Light or Night: the Night wash behind the header slid the app 80px. */
  { name: 'sideways-320',   cmd: ['node', 'tools/sideways_scroll_check.js', 'url'] },
  /* brand-images: the founder's rule of 2026-11-13. Only the painted art is on a screen (tools/brand-images.json):
     no flat face, no drawn bear, no emoji bear. Walks every screen at 390px; --self-test plants each defect. */
  { name: 'brand-images',   cmd: ['node', 'tools/brand_image_check.js', 'url', '--self-test'] },
  /* Usage events (admin spec §8, phase 2, USAGE_MODE stays off). usage-tracker drives the real tracker in the
     seeded app: no content leaves, nothing during her loss holding or a deletion, the notice holds linked events
     in mode on, one person's queue never leaves under another's token, the cap, the pagehide batch. --self-test
     serves mutants of app/cubby-track.js (and of its hooks) from temp copies of the tree; each must be caught.
     usage-ingest and usage-erasure (the server half) sit with tracking-plan, above. */
  { name: 'usage-tracker',  cmd: ['node', 'tools/usage_tracker_check.js', 'url', '--self-test'] },
  /* brand-py: the logo change as one tool (tools/brand.py propose, compare, zoom, set; docs/BRAND.md). Its
     self-test measures made-up subjects, proves compare byte-deterministic and draws sizes exactly as
     gen_brand_icons.py does, runs propose dry with fetch cut off, holds set to its refusals, and runs
     set --yes end to end on a miniature git copy of the tree in a temp folder. The real tree is never written. */
  { name: 'brand-py',       cmd: ['python3', 'tools/brand.py', '--self-test'] },
  /* crash-watch: the hourly TestFlight crash reader (tools/crash_watch.js, launchd com.cubby.crash-watch).
     Offline: a TestFlight text log and a simulator .ips of one crash share a signature, known/new/regressed
     follow the build numerically, each alert fires once, and no tester address reaches a report. */
  { name: 'crash-watch',    cmd: ['node', 'tools/crash_watch.js', '--self-test'] },
];

/* ---- Wiring and the push itself (Nov 2026, "a test not in gates.js does not exist"). ----
   Kept as its own list so parallel edits to TREE above do not collide with it. */
TREE.push(
  /* Every test/*.js and tools/*_check|_gate|_test.js is named here or excused with a checked reason. */
  { name: 'test-wiring',    cmd: ['node', 'tools/test_wiring_check.js', '--self-test'] },
  /* The pre-push refusal of product code with no test, proven in a throwaway repo. */
  { name: 'change-test',    cmd: ['node', 'tools/change_test_check.js', '--self-test'] },
  /* The real .githooks/pre-push, fed git's stdin: emulator tier for rules/Worker pushes, refusal works. */
  { name: 'prepush-tier',   cmd: ['node', 'test/prepush-tier.test.js'] },
  /* A real push from a LINKED worktree leaves the shared repository byte-identical (no gate inherits GIT_DIR). */
  { name: 'prepush-worktree', cmd: ['node', 'test/prepush-worktree.test.js'] },
  /* The nightly bug-bash's verdict, board line and open-findings ledger, over five synthetic nights. */
  { name: 'nightly-report', cmd: ['node', 'tools/nightly_report.js', '--self-test'] },
  /* The Worker under seeded malformed requests: never throws, never an undeclared 5xx, never reflects. */
  { name: 'fuzz-worker',    cmd: ['node', 'tools/fuzz_worker.js', '--self-test', '--seconds=20'] },
  /* Eleven gates that had been run by nothing. Each was watched red against an empty server and green
     against this tree on 2026-11-13; guide had three stale lines (fixed, see its comments) and
     marketing-type passed against an empty server (it now fails when it graded nothing). */
  { name: 'family-portrait', cmd: ['node', 'tools/family_portrait_check.js', 'url'] },
  { name: 'household-name', cmd: ['node', 'tools/household_name_check.js', 'url'] },
  { name: 'invite-arrival', cmd: ['node', 'tools/invite_arrival_check.js', 'url'] },
  { name: 'mkt-type',       cmd: ['node', 'tools/marketing_type_check.js', 'url'] },
  { name: 'rerender',       cmd: ['node', 'tools/rerender_gate.js', 'url'] },
  { name: 'avatar',         cmd: ['node', 'tools/avatar_test.js', 'url'] },
  { name: 'deletion-reach', cmd: ['node', 'tools/deletion_reachable_test.js', 'url'] },
  { name: 'dosecal',        cmd: ['node', 'tools/dosecal_test.js', 'url'] },
  { name: 'guide',          cmd: ['node', 'tools/guide_test.js', 'url'] },
  { name: 'vaxcard',        cmd: ['node', 'tools/vaxcard_test.js', 'url'] },
);
// These judge PRODUCTION, not this checkout, so a failure is a deploy problem rather than a code
// problem. Opt-in, because they need the network and they are the founder's to act on.
/* The real host, for the gates that must grade what is DEPLOYED rather than what is in the tree. */
const LIVE_URL = (process.env.CUBBY_LIVE_URL || 'https://little-cubby.com').replace(/\/$/, '');

const LIVE_GATES = [
  { name: 'thirdparty(live)', cmd: ['node', 'tools/thirdparty_gate.js'] },
  { name: 'claims(live)',     cmd: ['node', 'tools/claims_audit.js', 'url'] },
  /* 'liveurl', not 'url'. This is the one gate here that must ask PRODUCTION. Pointed at 'url' it
     got the local serve.js gates.js spawns over the repo root, which serves every file in the repo,
     so all 14 internal paths came back 200 and it reported production as wide open. It had never
     once actually checked production. claims(live) keeps 'url' on purpose — see its header: it needs
     the seeded ?e2e=1 shell, which is hostname-guarded to localhost. */
  { name: 'deploy-excl(live)',cmd: ['node', 'tools/deploy_exclusion_check.js', 'liveurl'] },
  /* The deployed admin (admin.little-cubby.com): every path, asked with no Access session, is a redirect
     to Access or a 401/403, and a 403 the Worker wrote carries its headers. Red until the founder's first
     admin deploy (docs/ADMIN-DEPLOY.md), which is what it is for. */
  { name: 'admin(live)',      cmd: ['node', 'tools/admin_live_check.js'] },
];
/* These need a real Firestore emulator, so they cannot run in the tree tier. loss-archive and
   push-query drive the app or the Worker's query against it rather than testing rules, which is
   why they live in test/ and still belong here. loss-archive starts what it needs itself, on the
   free ports the loop below hands it (it used to bind 8181 and 8080, and 8080 is usually taken). */
const EMU_GATES = [
  { name: 'rules',        emu: 'node rules-test.js' },
  { name: 'invite-link',  emu: 'node invite-link.test.js' },
  { name: 'push-query',   emu: 'node push-query.test.js' },
  { name: 'claim-rules',  emu: 'node signin-claim-rules.test.js' },
  { name: 'consent-blast',emu: 'node consent-blast.test.js' },
  { name: 'invite-join',  emu: 'node invite-join.test.js' },
  { name: 'loss-leak',    emu: 'node loss-leak.test.js' },
  { name: 'loss-archive', self: ['node', 'test/loss-archive-reload.test.js'] },
  /* The November 2026 security fixes that need a real Firestore to judge them. */
  { name: 'household-guard', emu: 'node household-guard.test.js' },        // caregiver cannot flag, rejoin or self-promote
  { name: 'signin-code-emu', emu: 'node signin-code-emulator.test.js' },   // the real conditional spend, race and burn
  { name: 'purge-unflag-emu', emu: 'node purge-unflag-emulator.test.js' }, // the bogus flag really clears
  { name: 'purge-erase-emu', emu: 'node purge-erase-emulator.test.js' },   // mhealth, pregnancy photos and memberEmails really go
  { name: 'feedback-purge-emu', emu: 'node feedback-purge-emulator.test.js' }, // her notes go by commit, and her hubs inside 50 subrequests
  { name: 'invite-consent', self: ['node', 'test/invite-consent.test.js'] },  // a newcomer is asked before joining
  { name: 'invite-cleanup', self: ['node', 'test/invite-cleanup.test.js'] },  // the one-off cleanup closes every lingering way back in
  { name: 'ios-signin', self: ['node', 'test/ios-signin-code.test.js'] },       // the installed iOS app signs in by code, in its own container
  { name: 'circle-manage', self: ['node', 'test/circle-manage.test.js'] },    // remove/cancel tap through, a removal closes every live link
  { name: 'signin-claim-auth', self: ['node', 'test/signin-claim-auth-emu.test.js'] }, // claiming an unproven account keeps HER one account (real Auth emulator)
  { name: 'removed-records', emu: 'node removed-records.test.js' },                  // a removed mother lists and deletes her own records; nobody else gains anything
  { name: 'removed-records-ui', self: ['node', 'test/removed-records-ui.test.js'] }, // ...from the note, and from account deletion
  { name: 'join-offline', self: ['node', 'test/join-offline.test.js'] },             // Join the family offline: the card, not an endless loader, and the join still lands
  { name: 'blob-sync', self: ['node', 'test/blob-sync.test.js'] },       // two phones keep every blob edit: lost update, legacy pregnancy, undefined (real rules)
  { name: 'quick-close-emu', self: ['node', 'test/quick-close-emulator.test.js'] }, // a reload 40 ms after logging keeps the entry (real rules, real IndexedDB)
  /* Lane B (Nov 2026 review D1, D4, P4): no caregiver can read a live link token; two deletions at
     once never leave a ghost owner or an empty family nobody purges; a removal closes her other invites. */
  { name: 'links-leave-rules', emu: 'node links-leave-rules.test.js' },
  { name: 'links-leave', self: ['node', 'test/links-leave.test.js'] },
  /* One invite per family per address (lane C): nobody can hold a person's invite slot against her
     real family, an owner's circle says when an invite was declined, and an empty Cubby is not warned
     about switching for good. */
  { name: 'invite-family-rules', emu: 'node invite-family-rules.test.js' },  // invites/{email}/from/{hid}: who reads, writes, joins, spends
  { name: 'invite-households', emu: 'node invite-households.test.js' },      // the founder's reports and the Worker's funnel query count both kinds of email invite
  { name: 'invite-family', self: ['node', 'test/invite-family.test.js'] },   // several families, "Not joined yet", the empty-Cubby question
  /* The admin Worker's masked reads, Auth listing and refresh on the REAL Firestore and Auth emulators:
     every mask honoured by the server, nothing planted reaches D1 or a page, a real 404 reads as held. */
  { name: 'admin-read-emu', self: ['node', 'test/admin-read-emulator.test.js'] },
];

/* ---- The emulator tier on FREE ports (Nov 2026, the pre-push emulator lane). ----
   Every emu suite used to run as `npx firebase-tools emulators:exec` from test/, which reads the repo's
   firebase.json and binds Firestore on 8080 (plus hub 4400, logging 4500, websocket 9150). On this Mac
   8080 is usually another session's server, so the tier either failed to start or, worse, a suite with a
   hard-coded host graded and CLEARED another session's emulator. So each run gets seven ports nothing is
   listening on: an `emu` suite runs inside a temp firebase.json that names them (rules copied from THIS
   tree), and a `self` suite gets them as FS_PORT/AUTH_PORT/WEB_PORT/STATIC_PORT/HUB_PORT/LOG_PORT/WS_PORT,
   which every self-hosting suite reads. The CLI is test/node_modules' own firebase when it is there, so
   nothing is fetched from npm at push time. */
async function emuPorts() {
  const names = ['FS_PORT', 'AUTH_PORT', 'WEB_PORT', 'STATIC_PORT', 'HUB_PORT', 'LOG_PORT', 'WS_PORT'];
  const out = {}, used = new Set();
  /* EMU_PORT_RANGE=7601-7639 keeps every pick inside a band a session has agreed to use (a shared Mac
     where other sessions own other ports); without it the OS hands out free ephemeral ports. */
  const band = /^(\d+)-(\d+)$/.exec(process.env.EMU_PORT_RANGE || '');
  let next = band ? Number(band[1]) : 0;
  for (const n of names) {
    let p = 0;
    if (band) {
      for (; next <= Number(band[2]) && !p; next++) if (await portIsFree(next)) p = next;
      if (!p) throw new Error('EMU_PORT_RANGE ' + band[0] + ' has no seven free ports');
    } else {
      p = await freePort();
      while (used.has(p)) p = await freePort();
    }
    used.add(p); out[n] = p;
  }
  return out;
}
function portIsFree(port) {
  return new Promise((res) => {
    const s = net.createServer();
    s.once('error', () => res(false));
    s.listen(port, '127.0.0.1', () => s.close(() => res(true)));
  });
}
function emuEnv(ports) {
  const env = Object.assign({}, process.env);
  Object.keys(ports).forEach((k) => { env[k] = String(ports[k]); });
  if (process.env.JAVA_HOME) env.PATH = path.join(process.env.JAVA_HOME, 'bin') + path.delimiter + (process.env.PATH || '');
  return env;
}
function emuConfig(ports) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-emu-'));
  fs.copyFileSync(path.join(ROOT, 'firestore.rules'), path.join(dir, 'firestore.rules'));
  fs.writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: { firestore: { port: ports.FS_PORT, websocketPort: ports.WS_PORT }, hub: { port: ports.HUB_PORT },
      logging: { port: ports.LOG_PORT }, ui: { enabled: false }, singleProjectMode: true },
  }));
  return dir;
}
function firebaseCli() {
  const local = path.join(ROOT, 'test', 'node_modules', '.bin', 'firebase');
  return fs.existsSync(local) ? [local] : ['npx', 'firebase-tools'];
}

/* Bug-bashing on the emulator: each self-test plants a known bug and must catch it (Nov 2026). The long
   seeded runs are nightly (tools/nightly.sh), not here. */
EMU_GATES.push(
  { name: 'fuzz-rules',   self: ['node', 'tools/fuzz_rules.js', '--self-test'] },   // model vs real rules, every role
  { name: 'chaos',        self: ['node', 'tools/chaos.js', '--self-test'] },        // two phones, real app, planted lost write
);

/* The tree server's port. Inside EMU_PORT_RANGE when one is set, so a session that agreed a band stays in
   it for every port this runner binds, taken from the TOP of the band so the emulator picks (which start
   at the bottom) are not pushed out of it; otherwise any free port, as before. */
async function treePort() {
  const band = /^(\d+)-(\d+)$/.exec(process.env.EMU_PORT_RANGE || '');
  if (!band) return freePort();
  for (let p = Number(band[2]); p >= Number(band[1]); p--) if (await portIsFree(p)) return p;
  throw new Error('EMU_PORT_RANGE ' + band[0] + ' has no free port for the tree server');
}
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
function waitFor(url, ms) {
  const stop = Date.now() + ms;
  return new Promise((res, rej) => {
    (function tick() {
      fetch(url).then(() => res()).catch(() => {
        if (Date.now() > stop) return rej(new Error('server never came up at ' + url));
        setTimeout(tick, 200);
      });
    })();
  });
}
/* No gate inherits the repository git handed a hook (Nov 2026). Inside a hook git exports GIT_DIR, and from a
   LINKED worktree it points into the SHARED repository (<repo>/.git/worktrees/<name>). Two gates build
   throwaway repos with plain `git init/config/commit/reset`, and with GIT_DIR inherited every one of those
   wrote the real repository instead: a probe push from a worktree left core.bare=true, core.hooksPath=/dev/null,
   a test user.email and rewritten branch heads, shared by every worktree, while the gate said PASS. Every
   gate runs with its cwd inside this checkout, so git still finds the right repository without them.
   test/prepush-worktree.test.js pushes from a real linked worktree and cuts the scrub line out to watch it go red. */
const GIT_REPO_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX'];
function childEnv(env) {
  const e = Object.assign({}, env || process.env);
  for (const k of GIT_REPO_ENV) delete e[k];
  return e;
}
function run(cmd, cwd, env) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(cmd[0], cmd.slice(1), { cwd: cwd || ROOT, env: childEnv(env) });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => res({ code, out, ms: Date.now() - t0 }));
    p.on('error', (e) => res({ code: 127, out: String(e.message), ms: Date.now() - t0 }));
  });
}
/* Every gate runs through here, so every gate is watched. Headless Chrome saves an <a download> into
   the real ~/Downloads, and by 2026-09-24 the suite had left 223 calendar files there, a pair a run.
   A gate that adds an entry to the watched folder FAILS, whatever its own exit code, and the failure
   names the files and the fix (tools/gate_downloads.js). `watch` is null where there is no ~/Downloads
   (CI is Linux), and then nothing is checked. */
async function runGate(name, cmd, cwd, watch, env) {
  const before = dl.snapshot(watch);
  const r = await run(cmd, cwd, env);
  const left = dl.added(before, dl.snapshot(watch));
  if (left.length) {
    r.code = r.code || 1;
    r.downloads = dl.guardMessage(name, left, watch);
    r.out += '\n' + r.downloads + '\n';
  }
  return r;
}
// The one line worth keeping from a gate that passed, or the first real failure from one that did not.
function gist(out, okRun) {
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  if (okRun) {
    const last = [...lines].reverse().find((l) => /PASS|✓|passed/.test(l));
    return (last || lines[lines.length - 1] || '').slice(0, 96);
  }
  const bad = lines.find((l) => /FAIL|✗|Error|error:|failed/.test(l));
  return (bad || lines[lines.length - 1] || 'no output').slice(0, 96);
}

/* node tools/gates.js --self-test-downloads. Real gates, run through the real runGate(), against a
   temp folder standing in for ~/Downloads, so proving the guard never writes to the real one. */
async function selfTestDownloads() {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 400) : '')); } };
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-downloads-guard-'));
  const plant = (name) => ['node', '-e', 'require("fs").writeFileSync(' + JSON.stringify(path.join(fake, name)) + ', "BEGIN:VCALENDAR")'];
  console.log('\ndownloads guard: a gate that saves into ~/Downloads fails, by name');

  const a = await runGate('vax-calendar', plant('robin-vaccines (7).ics'), ROOT, fake);
  ok('a gate that exits 0 but saves a file there FAILS', a.code !== 0, a.code);
  ok('naming the file it left', /robin-vaccines \(7\)\.ics/.test(a.out), a.out);
  ok('and the gate', /vax-calendar left 1 new entry/.test(a.out), a.out);
  ok('pointing at the helper', /downloadBehavior from tools\/gate_downloads\.js/.test(a.out), a.out);
  ok('and saying a download the human made trips it too', /A download you made yourself/.test(a.out), a.out);
  ok('in a line the summary row shows', /^FAIL downloads guard/.test(a.downloads || ''), a.downloads);

  const b = await runGate('quiet', ['node', '-e', '0'], ROOT, fake);
  ok('a gate that saves nothing passes, although the folder already holds files', b.code === 0 && !b.downloads, b.out);
  const c = await runGate('broken', ['node', '-e', 'process.exit(3)'], ROOT, fake);
  ok('a gate that fails on its own keeps its own exit code', c.code === 3, c.code);
  const d = await runGate('finder', plant('.DS_Store'), ROOT, fake);
  ok('Finder\'s .DS_Store is not a download', d.code === 0, d.out);
  if (process.platform === 'darwin') {
    /* A real download carries the app that saved it, which is how the founder tells a gate's file
       from one of their own. Stamp a planted file the way macOS stamps one, and read it back. */
    const stamp = path.join(fake, 'LEARNINGS.md');
    const q = await runGate('stamped', ['sh', '-c', 'printf x > "$0" && xattr -w com.apple.quarantine "0081;00000000;Claude;" "$0"', stamp], ROOT, fake);
    ok('a stamped download says which app saved it', /LEARNINGS\.md \(saved by Claude\)/.test(q.out), q.out);
    ok('an unstamped one claims no app', /robin-vaccines \(7\)\.ics(,|\n|$)/.test(a.out), a.out);
  }

  const noHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-no-downloads-'));
  ok('a machine with no ~/Downloads has nothing to watch', dl.userDownloads(noHome) === null, dl.userDownloads(noHome));
  const e = await runGate('ci', plant('anything.ics'), ROOT, dl.userDownloads(noHome));
  ok('and there the guard skips instead of failing', e.code === 0, e.out);

  /* runGate() is only worth something if the suite cannot run a gate around it. */
  const src = fs.readFileSync(__filename, 'utf8');
  ok('every gate the suite runs goes through runGate()', (src.match(/await run\(/g) || []).length === 1, (src.match(/await run\(/g) || []).length);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('DOWNLOADS-GUARD: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  return fail ? 1 : 0;
}

(async () => {
  if (ARGS.includes('--self-test-downloads')) process.exit(await selfTestDownloads());
  const port = await treePort();
  const base = 'http://127.0.0.1:' + port;
  console.log('\nCubby gates');
  console.log('serving THIS tree (' + ROOT + ') at ' + base);
  console.log('every browser gate is given that URL explicitly, so none of them can grade another checkout.\n');

  const server = spawn('node', ['tools/serve.js'], { cwd: ROOT, env: Object.assign(childEnv(), { PORT: String(port) }), stdio: 'ignore' });
  const stopServer = () => { try { server.kill(); } catch (e) {} };
  process.on('exit', stopServer);
  process.on('SIGINT', () => { stopServer(); process.exit(130); });
  try { await waitFor(base + '/app/', 15000); }
  catch (e) { console.error('could not start the local server: ' + e.message); stopServer(); process.exit(2); }

  let list = EMU_ONLY ? [] : TREE.slice();
  if (LIVE) list = list.concat(LIVE_GATES);
  if (NO_BROWSER) list = list.filter((g) => !g.cmd.includes('url'));
  if (ONLY) list = list.filter((g) => onlyMatch(g.name));

  const WATCH = dl.userDownloads();
  console.log(WATCH
    ? 'watching ' + WATCH + ': a gate that saves a file there fails, and so does one running while you download something.\n'
    : '(no ~/Downloads on this machine, so the downloads guard has nothing to watch.)\n');

  const results = [];
  for (const g of list) {
    const cmd = g.cmd.map((a) => (a === 'url' ? base : a === 'liveurl' ? LIVE_URL : a));
    process.stdout.write('  ' + g.name.padEnd(18));
    const r = await runGate(g.name, cmd, ROOT, WATCH);
    const okRun = r.code === 0;
    results.push({ name: g.name, ok: okRun, live: g.name.includes('(live)'), ms: r.ms, out: r.out });
    console.log((okRun ? 'ok  ' : 'FAIL') + '  ' + String((r.ms / 1000).toFixed(1) + 's').padStart(7) + '  ' + (r.downloads ? r.downloads.split('\n')[0] : gist(r.out, okRun)));
  }

  if (EMU) {
    console.log('\n  firestore emulator (each suite on its own free ports, never the 8080 default)');
    const emuList = ONLY ? EMU_GATES.filter((g) => onlyMatch(g.name)) : EMU_GATES;
    for (const g of emuList) {
      process.stdout.write('  ' + g.name.padEnd(18));
      /* Free ports for THIS run (see emuPorts below). A self-hosting suite starts its own emulator and
         web server and reads them from the environment; the rest run inside one we start from a temp
         firebase.json that names them. */
      const ports = await emuPorts();
      const env = emuEnv(ports);
      let r, cfgDir = null;
      if (g.self) r = await runGate(g.name, g.self, ROOT, WATCH, env);
      else {
        cfgDir = emuConfig(ports);
        r = await runGate(g.name, firebaseCli().concat(['emulators:exec', '--only', 'firestore', '--project', 'demo-cubby',
          '--config', path.join(cfgDir, 'firebase.json'), g.emu]), path.join(ROOT, 'test'), WATCH, env);
        try { fs.rmSync(cfgDir, { recursive: true, force: true }); } catch (e) {}
      }
      r.out = 'ports ' + JSON.stringify(ports) + '\n' + r.out;
      results.push({ name: g.name, ok: r.code === 0, ms: r.ms, out: r.out });
      console.log((r.code === 0 ? 'ok  ' : 'FAIL') + '  ' + String((r.ms / 1000).toFixed(1) + 's').padStart(7) + '  ' + (r.downloads ? r.downloads.split('\n')[0] : gist(r.out, r.code === 0)) + '  [firestore :' + ports.FS_PORT + ']');
    }
  }

  stopServer();
  const failed = results.filter((r) => !r.ok);
  const blocking = failed.filter((r) => !r.live);
  console.log('\n' + '-'.repeat(72));
  console.log(results.length + ' gates, ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');

  if (failed.length) {
    console.log('\nfull output from what failed:');
    failed.forEach((f) => {
      console.log('\n=== ' + f.name + ' ===');
      /* Keep the HEAD of the output as well as the tail. A gate names the host, port or tree it
         graded in its opening lines; the assertions come last. Tail-only truncation threw away the
         one line that identified the run and kept 14 that misdescribed it — deploy-excl(live) spent
         17 days reporting localhost's contents as production's, and the "live, <BASE>" header that
         would have shown it at a glance was exactly what fell off the top. */
      const lines = f.out.split('\n');
      const HEAD = 10, TAIL = 25;
      if (lines.length <= HEAD + TAIL) console.log(lines.join('\n'));
      else console.log(lines.slice(0, HEAD)
        .concat(['  … ' + (lines.length - HEAD - TAIL) + ' lines elided …'], lines.slice(-TAIL))
        .join('\n'));
    });
  }
  if (failed.some((r) => r.live) && !blocking.length) {
    console.log('\nOnly production checks failed. Nothing is wrong with this code: something that is');
    console.log('already deployed, or a dashboard setting, does not match what the repo promises.');
  }
  if (!LIVE) console.log('\n(production not checked. `node tools/gates.js --live` also audits what is deployed.)');
  if (!EMU) console.log('(firestore rules not checked. add --emulator for those.)');

  console.log(blocking.length ? '\nGATES: FAIL' : '\nGATES: PASS');
  process.exit(blocking.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
