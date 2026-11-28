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
 * for THIS working tree; it proves the server is this tree's before the first gate and after the last,
 * or refuses (see "The tree server" below).
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
  { name: 'ask-index',      cmd: ['node', 'tools/build_ask_index.js', '--check'] }, // the app's question box must match the articles (28 Nov: a stale index served old UAE emergency numbers)
  /* Health copy: no reviewer notes in a served page or its JSON-LD, no other country's crisis line on a
     country's page, and the rewritten health FAQs held in lockstep with their JSON-LD. Each staged red first. */
  { name: 'health-copy',    cmd: ['node', 'tools/health_copy_check.js', '--self-test'] },
  /* Health caution: every MEDICAL article carries the one caution under its title and links an official
     source in its sources list (docs/HEALTH-COPY-RULES.md); NON-MEDICAL ones carry the general line. */
  { name: 'health-caution', cmd: ['node', 'tools/health_caution_check.js', '--self-test'] },
  { name: 'claude-md',      cmd: ['node', 'tools/claudemd_check.js', '--self-test'] },
  { name: 'hooks',          cmd: ['node', 'tools/hooks_check.js', '--self-test'] },
  /* Every route worker.js serves is in run_worker_first; an unlisted one is answered by the asset layer
     (/api/* and AASA failed in production 24-27 Nov 2026). */
  { name: 'worker-first',   cmd: ['node', 'tools/worker_first_check.js', '--self-test'] },
  { name: 'harness',        cmd: ['node', 'tools/harness_check.js', '--self-test'] },
  /* The daily merge train (docs/RELEASE-TRAIN.md): green PRs only, CACHE-only sw.js conflicts settled,
     real conflicts skipped and aborted, CACHE ends above production. Real git in a temp repo. */
  { name: 'train',          cmd: ['node', 'tools/train.js', '--self-test'] },
  /* Clinical lock: a health page's words change only with 2+ clinician sign-offs at the new hash
     (docs/clinical-review/approved.json; reviewer details stay private in $CUBBY_SIGNOFFS) or a 14-day
     safety fix (docs/clinical-review/safety-fixes.json); other pages hold at tools/clinical-lock-baseline.json. */
  { name: 'clinical-lock',  cmd: ['node', 'tools/clinical_lock_check.js', '--self-test'] },
  { name: 'deploy-excl',    cmd: ['node', 'tools/deploy_exclusion_check.js', '--self-test'] },
  /* The guard that keeps gates out of ~/Downloads, and the helper that sends their files elsewhere. */
  { name: 'downloads-guard', cmd: ['node', 'tools/gates.js', '--self-test-downloads'] },
  { name: 'gate-downloads',  cmd: ['node', 'tools/gate_downloads.js', '--self-test', 'url'] },
  /* What the summary prints of a failing gate: every FAIL line and the 3 after it survive the elision. */
  { name: 'failure-excerpt', cmd: ['node', 'tools/gates.js', '--self-test-excerpt'] },
  /* The runner grades THIS tree or refuses: another checkout's server on the port it would pick (at any
     address), its own serve.js dying, a server serving other bytes, the server lost mid-run, a stranger that
     takes 127.0.0.1 at its port mid-run, and a SIGTERM, a SIGALRM (nightly.sh's watchdog) or a SIGKILL to the
     runner alone, after which its serve.js must be gone, each staged against a real runner in a temp tree
     (--self-test-tree-server). */
  { name: 'tree-server',     cmd: ['node', 'tools/gates.js', '--self-test-tree-server'] },
  { name: 'preg-tick-race', cmd: ['node', 'test/preg-tick-race.test.js', 'url'] },
  { name: 'two-caregivers', cmd: ['node', 'test/two-caregiver-journey.test.js', 'url'] },
  { name: 'mkt-contrast',   cmd: ['node', 'tools/marketing_contrast_check.js', 'url'] },
  { name: 'type',           cmd: ['node', 'tools/type_check.js', 'url'] },
  /* config/app reaches every phone with no deploy and no review, so the validator in front of it is
     held to a written contract: plain text, known hosts, locked safety widgets, nothing dropped. */
  { name: 'config',         cmd: ['node', 'tools/config_check.js', '--self-test'] },
  /* Every script holding the admin key uses firebase-admin's modular entry points: 14 dropped the
     namespace API and Cubby Ops crashed on it (16 Nov 2026). The self-test reads main's broken ops.js. */
  { name: 'admin-sdk',      cmd: ['node', 'tools/admin_sdk_check.js', '--self-test'] },
  /* nav-links(live)'s matcher, held red against this repo's own 404 page, and its live half held to node:https
     (fetch() sends no navigation header, so it passed against the broken production). */
  { name: 'nav-links',      cmd: ['node', 'tools/live_nav_check.js', '--self-test'] },
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
  /* What the "Log it" button SAYS for every answer /api/dose gives: "Dose logged" only for a dose written,
     facts for a second dose, nothing named on the lock screen. It said "Dose logged" over nothing saved. */
  { name: 'dose-button',    cmd: ['node', 'test/dose-button.test.js', '--self-test'] },
  /* Every limiter call goes through rateLimited(), which fails open but never silently: a throw, a
     malformed reply and a denial are each logged. Production went months without one 429. */
  { name: 'ratelimit',      cmd: ['node', 'test/ratelimit.test.js', '--self-test'] },
  { name: 'push-delivery',  cmd: ['node', 'test/push-delivery.test.js'] },
  { name: 'signin-canary',  cmd: ['node', 'test/signin-canary.test.js'] },
  /* The funnel: derivation, Worker, client, and the plan they all answer to. Each proven red. */
  { name: 'funnel-core',    cmd: ['node', 'test/funnel-core.test.js'] },
  { name: 'funnel-worker',  cmd: ['node', 'test/funnel-worker.test.js'] },
  /* The native wrapper routes each link once per open (getLaunchUrl answers with the process's LAST link on
     every page load; a sign-in link looped on it, 16 Nov 2026) and keeps a token invite link. --self-test
     first turns every rule red on a mutated copy of app/native-bridge.js. */
  { name: 'native-deeplink', cmd: ['node', 'test/native-deeplink.test.js', '--self-test'] },
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
  { name: 'prod-counts',    cmd: ['node', 'tools/prod_counts.js', '--self-test'] },  // read-only aggregate counts; the self-test fails on any write call
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
     This is its tree tier (S0-S19, and S8b: what account deletion says, read off index.html for every stage): Chrome
     only, no java and no emulator jar. The sections that run the real sync layer on a Firestore emulator (S20-S23b,
     with their mutants) are usage-tracker-emu, in EMU_GATES below.
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
  /* The nightly bug-bash's verdict, board line and open-findings ledger, over synthetic nights in a temp dir. */
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
/* Home-screen widgets, plan 1 (web foundations). One block; each task adds its gate here. */
TREE.push(
  { name: 'widget-snapshot', cmd: ['node', 'test/widget-snapshot.test.js', 'url'] },   // the shared since-rules, both copies, held equal
  { name: 'widget-parity', cmd: ['node', 'tools/widget_parity_check.js', '--self-test'] },   // the widget copy rules, the Quick-action fields and the generated files
);
/* Did the sign-in email actually go? (P0, 16 Nov 2026: Resend accepted three sends to a new Gmail address and
   none arrived, while the app said "we just emailed you".) A send's sendRef and its one log line (Resend's id,
   never the address), /api/signin-status's coarse answer for every Resend event and every failure, the bound
   on lookups, same-origin and its own limiter bucket, no address in any cache key, and a cooldown answer that
   says what is settled about its email (looking once itself when nobody has asked yet); driven through the real
   worker.js. --self-test breaks worker.js eighteen ways in memory and each must turn its own check red. */
TREE.push(
  { name: 'signin-delivery', cmd: ['node', 'test/signin-delivery.test.js', '--self-test'] },
  /* The live delivery check's checker, against a stand-in Worker on 127.0.0.1 only. Its live mode sends real
     email through Resend and refuses to start without --live --yes-send-real-email: the founder's call, never
     a gate's. */
  { name: 'mail-delivery-self', cmd: ['node', 'tools/mail_delivery_check.js', '--self-test'] },
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
  /* The sign-in link and a shared game link, asked the way a BROWSER asks (a navigation): from 8 Jul to
     17 Nov 2026 both got the 404 page in every browser while every script still reached the Worker. */
  { name: 'nav-links(live)',  cmd: ['node', 'tools/live_nav_check.js'] },
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
  { name: 'dose-emu',     emu: 'node dose-slot-emulator.test.js' },       // "Log it": the real create, repeat and earlier-dose query
  { name: 'purge-erase-emu', emu: 'node purge-erase-emulator.test.js' },   // mhealth, pregnancy photos and memberEmails really go
  { name: 'feedback-purge-emu', emu: 'node feedback-purge-emulator.test.js' }, // her notes go by commit, and her hubs inside 50 subrequests
  { name: 'invite-consent', self: ['node', 'test/invite-consent.test.js'] },  // a newcomer is asked before joining
  { name: 'invite-cleanup', self: ['node', 'test/invite-cleanup.test.js'] },  // the one-off cleanup closes every lingering way back in
  { name: 'ios-signin', self: ['node', 'test/ios-signin-code.test.js'] },       // the installed iOS app signs in by code, in its own container
  { name: 'native-signin-link', self: ['node', 'test/native-signin-link.test.js'] }, // the email's link signs her in to the iPhone app once, nothing asked (real Auth emulator)
  { name: 'circle-manage', self: ['node', 'test/circle-manage.test.js'] },    // remove/cancel tap through, a removal closes every live link
  { name: 'signin-claim-auth', self: ['node', 'test/signin-claim-auth-emu.test.js'] }, // claiming an unproven account keeps HER one account (real Auth emulator)
  { name: 'next-account-cache-emu', self: ['node', 'test/next-account-cache-emulator.test.js'] }, // what one person logged before signing in never reaches the next account on that phone (real client, real rules)
  { name: 'stale-family-emu', self: ['node', 'test/stale-family-memory-emulator.test.js'] }, // after a sign-out nothing on the page still names the family left: no stale id on feedback, roster or Pro (real client, real rules)
  { name: 'removed-records', emu: 'node removed-records.test.js' },                  // a removed mother lists and deletes her own records; nobody else gains anything
  { name: 'removed-records-ui', self: ['node', 'test/removed-records-ui.test.js'] }, // ...from the note, and from account deletion
  { name: 'join-offline', self: ['node', 'test/join-offline.test.js'] },             // Join the family offline: the card, not an endless loader, and the join still lands
  { name: 'blob-sync', self: ['node', 'test/blob-sync.test.js'] },       // two phones keep every blob edit: lost update, legacy pregnancy, undefined (real rules)
  { name: 'quick-close-emu', self: ['node', 'test/quick-close-emulator.test.js'] }, // a reload 40 ms after logging keeps the entry (real rules, real IndexedDB)
  { name: 'local-author-sync-emu', self: ['node', 'test/local-author-sync-emulator.test.js'] }, // an entry authored local still syncs; an owner's edit keeps the caregiver as author (real rules)
  /* Lane B (Nov 2026 review D1, D4, P4): no caregiver can read a live link token; two deletions at
     once never leave a ghost owner or an empty family nobody purges; a removal closes her other invites. */
  { name: 'links-leave-rules', emu: 'node links-leave-rules.test.js' },
  { name: 'links-leave', self: ['node', 'test/links-leave.test.js'] },
  /* One invite per family per address (lane C): nobody can hold a person's invite slot against her
     real family, an owner's circle says when an invite was declined, and an empty Cubby is not warned
     about switching for good. */
  { name: 'invite-family-rules', emu: 'node invite-family-rules.test.js' },  // invites/{email}/from/{hid}: who reads, writes, joins, spends
  { name: 'invite-households', emu: 'node invite-households.test.js' },      // the founder's reports and the Worker's funnel query count both kinds of email invite
  { name: 'ops-admin', emu: 'node ops-admin.test.js' },                      // Cubby Ops serves /api/data from a real Firestore on firebase-admin 14
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
  const picked = await freePorts(names.length), out = {};
  names.forEach((n, i) => { out[n] = picked[i]; });
  return out;
}
/* n distinct free ports. EMU_PORT_RANGE=7601-7639 keeps every pick inside a band a session has agreed to use
   (a shared Mac where other sessions own other ports), searched from the bottom; without it the OS hands out
   free ephemeral ports. tools/nightly.sh takes its ports here too (--free-ports=N), so there is one picker. */
async function freePorts(n) {
  const band = /^(\d+)-(\d+)$/.exec(process.env.EMU_PORT_RANGE || '');
  const out = [];
  if (band) {
    for (let p = Number(band[1]); p <= Number(band[2]) && out.length < n; p++) if (await portIsFree(p)) out.push(p);
    if (out.length < n) throw new Error('EMU_PORT_RANGE ' + band[0] + ' has no ' + n + ' free ports');
    return out;
  }
  while (out.length < n) { const p = await freePort(); if (!out.includes(p)) out.push(p); }
  return out;
}
/* Free means nothing listens there at ANY address a gate's URL can reach. serve.js listens on the wildcard
   address, the gates ask 127.0.0.1, and the self-hosting suites ask `localhost` (::1 first on macOS). On macOS
   a socket can bind 127.0.0.1 beside a server already listening on [::] at the same port, and [::] beside one
   on 0.0.0.0 (both measured on 16 Nov 2026), so asking 127.0.0.1 alone called a port held by another
   session's serve.js free, and this run's own serve.js then died on EADDRINUSE while the other answered. An
   address family this machine does not have (no IPv6) holds nothing, so it does not make a port busy. */
const PORT_HOSTS = [undefined, '0.0.0.0', '127.0.0.1', '::1'];
function portFreeOn(port, host) {
  return new Promise((res) => {
    const s = net.createServer();
    s.once('error', (e) => res(e.code === 'EAFNOSUPPORT' || e.code === 'EADDRNOTAVAIL'));
    s.listen(host === undefined ? { port } : { port, host }, () => s.close(() => res(true)));
  });
}
async function portIsFree(port) {
  for (const h of PORT_HOSTS) if (!(await portFreeOn(port, h))) return false;
  return true;
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
  { name: 'chaos',        self: ['node', 'tools/chaos.js', '--self-test'] },        // two phones, real app, planted lost write, a deletion after a stale sign-in
);
/* The usage tracker's emulator tier (tools/usage_tracker_check.js --emulator): PRIV-4 through the real sign-in
   layer (S20), a deletion that does not finish and signing out (S21), account deletion saying only what is true,
   with the recent sign-in asked for before anything is deleted, on the web and in the iPhone app (S22), a stop at
   the login signing her out and "sign in again, then delete" finishing it (S23, S23b), and a leave whose answer was
   lost not stopping the deletion (S24), S23-S24 under this tree's firestore.rules; --self-test runs their
   mutants.
   A browser gate, so it gets 'url' (the tree server, below) like a tree gate, and FS_PORT/WS_PORT for the
   Firestore emulator it starts itself from the jar firebase-tools caches. Kept after `rules`, which downloads
   that jar on a fresh machine (CI). It used to run in the tree tier, which made every push need java. */
EMU_GATES.push(
  { name: 'usage-tracker-emu', self: ['node', 'tools/usage_tracker_check.js', 'url', '--emulator', '--self-test'] },
);
/* The usage events' SQL on workerd's OWN D1 (Miniflare, local and offline: started with cf: false, and any
   socket beyond loopback is refused and fails the gate), not only on the node:sqlite shim every other usage
   test uses: what D1 refuses (BEGIN, SAVEPOINT, a bound undefined, 101 parameters, a 6-term compound SELECT,
   a 51-byte LIKE pattern), the real code paths on both engines with every answer compared, D1's rows_written
   against wrangler.toml's write arithmetic, and usage-ingest, usage-route, usage-erasure and admin-screens
   re-run on D1 with every statement shadowed on node:sqlite. --self-test: each break D1 alone can see must be
   red on D1 and green on the shim, and a harness started without cf: false must be caught reaching out.
   Emulator tier because it starts a runtime of its own; it finds the pinned miniflare in tools/node_modules
   (CI's emulator job installs it) or npx's cache (MINIFLARE_PATH is held to the same pin), and fails, never
   skips, without it. A push touching only wrangler.toml or schema/usage.sql runs this tier too. A SIGTERM,
   SIGINT, SIGHUP or SIGALRM to a process holding a D1 stops its workerd first (section 0 checks each). */
EMU_GATES.push(
  { name: 'usage-d1', self: ['node', 'test/usage-d1-engine.test.js', '--self-test'] },
);
/* The same delivery checks on workerd itself (Miniflare, offline): the sendRef entry and the hashed cooldown in
   workerd's own Cache API (nothing under the address), AbortSignal.timeout, a real rate-limit binding, and
   workerd's console. Emulator tier because it starts a runtime; WEB_PORT is workerd's port. The panel's half
   (what she sees for each answer) is in ios-signin, above. */
EMU_GATES.push(
  { name: 'signin-delivery-workerd', self: ['node', 'test/signin-delivery-workerd.test.js'] },
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
/* An ephemeral port the OS hands out on 127.0.0.1, kept only if it is free at every address (portIsFree). */
async function freePort() {
  for (let i = 0; i < 50; i++) {
    const p = await new Promise((res, rej) => {
      const s = net.createServer();
      s.on('error', rej);
      s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => res(q)); });
    });
    if (await portIsFree(p)) return p;
  }
  throw new Error('no port the OS offered was free at every address (50 tries)');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- The tree server is THIS tree's, from before the first gate to after the last (Nov 2026). ----
   A run graded another checkout while its banner said "serving THIS tree". Another session's orphaned serve.js
   held [::]:7739; the port check asked only 127.0.0.1, so 7739 looked free; this run's serve.js died on
   EADDRINUSE, unseen because its output was ignored; and waitFor() took any answer, which came from the
   orphan. usage-tracker then failed a check this tree passes, on that tree's older app; the mirror case is a
   pass for code that is broken. So the run now refuses before the first gate unless:
     - the port was free at every address (portIsFree above);
     - THIS run's serve.js said it is listening (its "serving" line), and had not exited;
     - TREE_PROOF, fetched from the server, is byte for byte what this tree holds (a file this tree does not
       have must be a 404; test/prepush-worktree.test.js runs this runner in a throwaway repo with no app/).
   After the last gate the server must still be up and still serve those bytes, or the run fails; and no gate
   starts after it has exited. `node tools/gates.js --self-test-tree-server` stages each of these. */
const TREE_PROOF = ['app/index.html', 'app/store-firebase.js', 'app/sw.js'];
/* One GET on a connection of its own (agent: false): a pooled one could be a socket the server already closed. */
function getBytes(url) {
  return new Promise((res, rej) => {
    const req = require('http').get(url, { agent: false }, (r) => {
      const parts = [];
      r.on('data', (d) => parts.push(d));
      r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(parts) }));
      r.on('error', rej);
    });
    req.on('error', rej);
    req.setTimeout(10000, () => req.destroy(Object.assign(new Error('no answer in 10 s'), { code: 'ETIMEDOUT' })));
  });
}
async function treeMismatch(root, base) {
  const bad = [];
  for (const rel of TREE_PROOF) {
    let want = null;
    try { want = fs.readFileSync(path.join(root, rel)); } catch (e) { want = null; }
    let status = 0, got = null;
    try { const r = await getBytes(base + '/' + rel); status = r.status; got = r.body; }
    catch (e) { bad.push(rel + ' got no answer (' + (e.code || e.message) + ')'); continue; }
    if (want === null) { if (status !== 404) bad.push(rel + ' is not in this tree, yet it was served (' + status + ', ' + got.length + ' bytes)'); continue; }
    if (status !== 200) { bad.push(rel + ' answered ' + status + ' (this tree has ' + want.length + ' bytes)'); continue; }
    if (!got.equals(want)) {
      let i = 0;
      while (i < want.length && i < got.length && want[i] === got[i]) i++;
      bad.push(rel + ' differs: ' + got.length + ' bytes served, ' + want.length + ' in this tree, the first difference at byte ' + i);
    }
  }
  return bad;
}
/* Asked twice before it says no, so a file saved in the middle of the comparison is not taken for a stranger. */
async function checkTree(root, base) {
  const bad = await treeMismatch(root, base);
  if (!bad.length) return bad;
  await sleep(300);
  return treeMismatch(root, base);
}
/* The tree server lives only as long as this runner. serve.js runs inside a small wrapper that exits when its
   stdin closes, and its stdin is a pipe only this runner holds, which the OS closes however the runner ends:
   a SIGKILL, or a signal with no handler here, included. Before (16 Nov 2026), nightly.sh's watchdog (perl's
   alarm, then exec) ended a run with SIGALRM, which nothing caught, and its serve.js went on listening with
   PPID 1 (seen on :7879), the same leftover as the orphans in this machine's port bands. serve.js itself is
   unchanged and still the tree's own: the wrapper loads it by path, so it serves the folder it sits in and
   prints its "serving" line. */
const TETHER = 'process.stdin.on("end", () => process.exit(0)); process.stdin.on("error", () => process.exit(0));'
  + ' process.stdin.resume(); require(process.argv[1]);';
/* Starts root's own serve.js on port and resolves once it is listening and serving root's bytes; otherwise it
   kills it and rejects with the reason. `track` gets the handle at once, so a signal during the start can
   stop it. handle.gone is set if it exits on its own (not by stop()). */
function startTreeServer(root, port, track) {
  const proc = spawn(process.execPath, ['-e', TETHER, path.join(root, 'tools', 'serve.js')],
    { cwd: root, env: Object.assign(childEnv(), { PORT: String(port) }), stdio: ['pipe', 'pipe', 'pipe'] });
  const srv = { proc, port, base: 'http://127.0.0.1:' + port, said: '', gone: null, stopping: false,
    stop() { srv.stopping = true; try { proc.kill(); } catch (e) { /* already gone */ } } };
  if (track) track(srv);
  const keep = (d) => { if (srv.said.length < 8000) srv.said += d; };
  proc.stdout.on('data', keep);
  proc.stderr.on('data', keep);
  proc.on('close', (code, signal) => { if (!srv.stopping) srv.gone = signal ? 'killed by ' + signal : 'exit code ' + code; });
  proc.on('error', (e) => { if (!srv.stopping) srv.gone = 'it could not start: ' + e.message; });
  const reason = () => { const l = srv.said.split('\n').find((x) => /Error|EADDR/.test(x)) || srv.said.split('\n')[0] || 'it printed nothing'; return l.trim().slice(0, 160); };
  const look = '\n  Another checkout\'s server may be listening there: lsof -nP -iTCP:' + port + ' -sTCP:LISTEN';
  return (async () => {
    const until = Date.now() + 15000;
    while (!/^serving /m.test(srv.said) || !proc.pid) {
      if (srv.gone) throw new Error('the tree server for ' + root + ' on port ' + port + ' exited before it was listening (' + srv.gone + '): ' + reason() + look);
      if (Date.now() > until) throw new Error('the tree server for ' + root + ' on port ' + port + ' never said it was listening' + look);
      await sleep(50);
    }
    const bad = await checkTree(root, srv.base);
    if (srv.gone) throw new Error('the tree server for ' + root + ' on port ' + port + ' exited as it started (' + srv.gone + '): ' + reason() + look);
    if (bad.length) throw new Error('what answers at ' + srv.base + ' is not THIS tree (' + root + '): ' + bad.join('; ') + look);
    return srv;
  })().catch((e) => { srv.stop(); throw e; });
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
/* The gate running now, so a SIGTERM, SIGHUP or SIGALRM sent to this runner reaches it too (see the handlers below). */
let runningGate = null;
function run(cmd, cwd, env) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(cmd[0], cmd.slice(1), { cwd: cwd || ROOT, env: childEnv(env) });
    runningGate = p;
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => { if (runningGate === p) runningGate = null; res({ code, out, ms: Date.now() - t0 }); });
    p.on('error', (e) => { if (runningGate === p) runningGate = null; res({ code: 127, out: String(e.message), ms: Date.now() - t0 }); });
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

/* What the summary prints of a failing gate's output. Keep the HEAD as well as the tail. A gate names the host,
   port or tree it graded in its opening lines; the assertions come last. Tail-only truncation threw away the one
   line that identified the run and kept 14 that misdescribed it: deploy-excl(live) spent 17 days reporting
   localhost's contents as production's, and the "live, <BASE>" header that would have shown it at a glance was
   exactly what fell off the top. */
const EXCERPT_HEAD = 10, EXCERPT_TAIL = 25;
/* And every FAIL line, with the 3 after it (a check's got: detail is the line after), wherever it falls: a
   long gate's failure sits in its middle, and S21.again-flows failed on CI three times in Nov 2026 with its
   detail among the elided lines. */
const EXCERPT_AFTER = 3;
function excerpt(out) {
  const lines = String(out).split('\n');
  const HEAD = EXCERPT_HEAD, TAIL = EXCERPT_TAIL;
  if (lines.length <= HEAD + TAIL) return lines.join('\n');
  const keep = lines.map((l, i) => i < HEAD || i >= lines.length - TAIL);
  lines.forEach((l, i) => { if (/\bFAIL\b/.test(l)) for (let j = i; j <= i + EXCERPT_AFTER && j < lines.length; j++) keep[j] = true; });
  const shown = [];
  for (let i = 0; i < lines.length;) {
    if (keep[i]) { shown.push(lines[i]); i++; continue; }
    let j = i; while (j < lines.length && !keep[j]) j++;
    shown.push('  … ' + (j - i) + (j - i === 1 ? ' line' : ' lines') + ' elided …');
    i = j;
  }
  return shown.join('\n');
}

/* node tools/gates.js --self-test-excerpt. A long failing output, as usage-tracker-emu's is on CI (its run,
   then 26 mutants), with the one FAIL and its got: detail in the middle: the printed excerpt must carry them.
   S21.again-flows failed on CI three times in Nov 2026 and each time its detail was among the elided lines. */
function selfTestExcerpt() {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 600) : '')); } };
  console.log('\nfailure excerpt: a failing gate\'s FAIL lines and their detail survive the elision');
  const pad = (k, n) => Array.from({ length: n }, (_, i) => '  ok   ' + k + '.' + i + ' a check that passed');
  const out = ['usage-tracker (emulator tier): http://127.0.0.1:1  sections S21', 'firestore emulator: jar on 127.0.0.1:2']
    .concat(pad('S20', 40), [
      '  FAIL S21.again-flows signed out and in again on the same page: her events flow again',
      '         got: {"oldHid":"h1","back":"h2","seen":"zz-del-late","sent":[]}',
      '  ok   S21.next one',
      '  ok   S21.and the next',
      '  ok   S21.fourth after: may go',
    ], pad('S22', 40), [
      '  FAIL S23.second a second failure',
      '         got: {"second":true}',
    ], pad('S24', 40), ['self-test: 26 of 26 mutants caught', 'USAGE-TRACKER SELF-TEST: PASS']).join('\n');
  const got = excerpt(out), gl = got.split('\n');
  ok('the first FAIL line is printed', gl.includes('  FAIL S21.again-flows signed out and in again on the same page: her events flow again'), got);
  ok('with its got: detail', /got: \{"oldHid":"h1","back":"h2","seen":"zz-del-late","sent":\[\]\}/.test(got), got);
  ok('and the two lines after that', gl.includes('  ok   S21.next one') && gl.includes('  ok   S21.and the next'), got);
  ok('a second FAIL and its detail too', gl.includes('  FAIL S23.second a second failure') && gl.includes('         got: {"second":true}'), got);
  ok('the head is kept (the run names what it graded)', gl[0] === 'usage-tracker (emulator tier): http://127.0.0.1:1  sections S21', gl[0]);
  ok('the tail is kept', gl[gl.length - 1] === 'USAGE-TRACKER SELF-TEST: PASS', gl[gl.length - 1]);
  ok('the rest is still elided, and says how much', /lines elided/.test(got) && gl.length < out.split('\n').length && !gl.includes('  ok   S22.20 a check that passed'), gl.length);
  ok('the fourth line after a FAIL is elided', !gl.includes('  ok   S21.fourth after: may go'), got);
  const n = got.match(/… (\d+) lines? elided …/g) || [];
  const shown = gl.filter((l) => !/lines? elided/.test(l)).length, hidden = n.reduce((a, x) => a + Number(/\d+/.exec(x)[0]), 0);
  ok('every line is either printed or counted as elided', shown + hidden === out.split('\n').length, { shown, hidden, total: out.split('\n').length });
  const short = 'a\nFAIL b\nc';
  ok('a short output is printed whole', excerpt(short) === short, excerpt(short));
  const src = fs.readFileSync(__filename, 'utf8');
  ok('the summary prints each failed gate through excerpt()', /failed\.forEach\(\(f\) => \{[^}]*console\.log\(excerpt\(f\.out\)\)/.test(src));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('FAILURE-EXCERPT SELF-TEST: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  return fail ? 1 : 0;
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

/* node tools/gates.js --self-test-tree-server. Every way a run could grade a server that is not THIS tree's is
   staged against a real runner, each in a temp tree of its own (the runner, its serve.js, three small app files
   and a gate that waits until it is let go), never the real app; each run must refuse or fail, saying why.
   GATES_SELF_TEST_SOURCE=<a gates.js> aims those runs at another runner: on 72d7c68f's they go red. */
async function selfTestTreeServer() {
  const http = require('http');
  const { spawnSync } = require('child_process');
  let pass = 0, fail = 0;
  const ok = (n, c, x) => {
    if (c) { pass++; console.log('  ok   ' + n); return; }
    fail++;
    console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(-1200).replace(/\n/g, '\n         ') : ''));
  };
  const SRC = path.resolve(process.env.GATES_SELF_TEST_SOURCE || __filename);
  const RUNNER = fs.readFileSync(SRC, 'utf8');
  const SERVE = fs.readFileSync(path.join(__dirname, 'serve.js'), 'utf8');
  console.log('\ntree server: a run grades THIS tree, or refuses before its first gate'
    + (SRC !== __filename ? '\n  the runner under test: ' + SRC : ''));
  const APP = { 'app/index.html': '<!doctype html><title>the tree under test</title>\n', 'app/store-firebase.js': '// the store\n', 'app/sw.js': 'const CACHE = 1;\n' };
  const OLDER = Object.assign({}, APP, { 'app/index.html': APP['app/index.html'] + '<!-- an older checkout -->\n' });
  const made = [], plants = [], pids = [];
  const HOLD_GATE = 'self-test-hold';
  const HOLD = 'const fs = require("fs"), p = require("path"), t0 = Date.now();\n'
    + 'fs.writeFileSync(p.join(__dirname, "hold.pid"), String(process.pid));\n'
    + '(function w() { if (fs.existsSync(p.join(__dirname, "release")) || Date.now() - t0 > 60000) process.exit(0); setTimeout(w, 50); })();\n';
  /* A checkout of its own. edit(src) changes the runner (a mutant), serve replaces its serve.js, noApp leaves
     app/ out. Its TREE gains the hold gate, which writes its pid and exits 0 once `release` exists, and a gate
     after it that passes at once. */
  function tempTree(o) {
    o = o || {};
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-gates-tree-'));
    made.push(t);
    fs.mkdirSync(path.join(t, 'tools'));
    let src = o.edit ? o.edit(RUNNER) : RUNNER;
    const at = src.indexOf('TREE.push(\n');
    if (at >= 0) {
      src = src.slice(0, at + 11) + '  { name: ' + JSON.stringify(HOLD_GATE) + ', cmd: ' + JSON.stringify([process.execPath, path.join(t, 'hold.js')]) + ' },\n'
        + '  { name: ' + JSON.stringify(HOLD_GATE + '-after') + ', cmd: ' + JSON.stringify([process.execPath, '-e', '0']) + ' },\n' + src.slice(at + 11);
    }
    fs.writeFileSync(path.join(t, 'tools', 'gates.js'), src);
    fs.copyFileSync(path.join(__dirname, 'gate_downloads.js'), path.join(t, 'tools', 'gate_downloads.js'));
    fs.writeFileSync(path.join(t, 'tools', 'serve.js'), o.serve || SERVE);
    fs.writeFileSync(path.join(t, 'hold.js'), HOLD);
    if (!o.noApp) { fs.mkdirSync(path.join(t, 'app')); for (const rel of Object.keys(APP)) fs.writeFileSync(path.join(t, rel), APP[rel]); }
    return t;
  }
  /* A server already listening, as another session's serve.js would be: it serves `files` and counts asks. */
  function plant(port, host, files, v6only) {
    return new Promise((res) => {
      const s = http.createServer((q, r) => {
        s.hits++;
        const body = files[decodeURIComponent(String(q.url).split('?')[0]).replace(/^\/+/, '')];
        r.writeHead(body === undefined ? 404 : 200);
        r.end(body === undefined ? '404' : body);
      });
      s.hits = 0;
      s.once('error', (e) => res({ err: e.code }));
      s.listen(Object.assign({ port }, host === undefined ? {} : { host }, v6only ? { ipv6Only: true } : {}), () => { plants.push(s); res({ s }); });
    });
  }
  const unplant = (s) => new Promise((r) => { if (!s) return r(); s.close(() => r()); if (s.closeAllConnections) s.closeAllConnections(); });
  /* n consecutive free ports: from the bottom of EMU_PORT_RANGE (the runner that started this took the top), or
     wherever the OS offers. */
  async function freeRun(n) {
    const band = /^(\d+)-(\d+)$/.exec(process.env.EMU_PORT_RANGE || '');
    const all = async (p) => { for (let k = 0; k < n; k++) if (!(await portIsFree(p + k))) return false; return true; };
    if (band) { for (let p = Number(band[1]); p + n - 1 <= Number(band[2]); p++) if (await all(p)) return p; throw new Error('EMU_PORT_RANGE ' + band[0] + ' has no ' + n + ' free ports in a row'); }
    for (let i = 0; i < 100; i++) { const p = await freePort(); if (p + n - 1 <= 65535 && await all(p)) return p; }
    throw new Error('no ' + n + ' free ports in a row');
  }
  /* A runner in tree t, its own band given explicitly. */
  function child(t, args, band) {
    const env = Object.assign(childEnv(), { EMU_PORT_RANGE: band });
    const proc = spawn(process.execPath, [path.join(t, 'tools', 'gates.js')].concat(args), { cwd: t, env });
    const c = { proc, out: '' };
    proc.stdout.on('data', (d) => { c.out += d; });
    proc.stderr.on('data', (d) => { c.out += d; });
    const timer = setTimeout(() => { c.out += '\n[self-test: still running after 120 s, killed]'; try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } }, 120000);
    c.done = new Promise((res) => proc.on('close', (code, signal) => { clearTimeout(timer); res({ code, signal, out: c.out }); }));
    return c;
  }
  const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return !!(await fn()); };
  const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  const listening = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });
  const childrenOf = (pid) => { const r = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }); return String(r.stdout || '').split('\n').map(Number).filter(Boolean); };
  const holdPid = (t) => { try { return Number(fs.readFileSync(path.join(t, 'hold.pid'), 'utf8')); } catch (e) { return 0; } };
  const refusedFirst = (r) => r.code === 2 && !/serving THIS tree/.test(r.out) && !/GATES: PASS/.test(r.out);
  /* The picker 72d7c68f had (127.0.0.1 alone), so the checks after it can be staged on their own. It replaces the
     runner's own PORT_HOSTS declaration, whatever that line holds (a line that starts with it, which no string in
     this self-test does); a runner without one (72d7c68f's) is left as it is. */
  const oldPicker = (src) => src.replace(/^const PORT_HOSTS = \[[^\]\n]*\];$/m, "const PORT_HOSTS = ['127.0.0.1'];");
  const NONE = '--only=no-gate-has-this-name';

  try {
    /* The comparison itself, on servers planted here. */
    {
      const t = tempTree(), bare = tempTree({ noApp: true });
      const p = await freeRun(1);
      let pl = await plant(p, '127.0.0.1', APP);
      ok('the tree check passes a server that serves this tree byte for byte', (await treeMismatch(t, 'http://127.0.0.1:' + p)).length === 0, await treeMismatch(t, 'http://127.0.0.1:' + p));
      const asBare = await treeMismatch(bare, 'http://127.0.0.1:' + p);
      ok('and names each file a tree without app/ (the throwaway repo of prepush-worktree) does not hold, when served', asBare.length === 3 && asBare.every((x) => /is not in this tree, yet it was served \(200/.test(x)), asBare);
      await unplant(pl.s);
      pl = await plant(p, '127.0.0.1', OLDER);
      const older = await treeMismatch(t, 'http://127.0.0.1:' + p);
      ok('it names the file and the byte where another checkout differs', older.length === 1 && older[0].startsWith('app/index.html differs') && older[0].endsWith('at byte ' + APP['app/index.html'].length), older);
      await unplant(pl.s);
      pl = await plant(p, '127.0.0.1', {});
      ok('companion: for a tree without app/, 404s are the right answer', (await treeMismatch(bare, 'http://127.0.0.1:' + p)).length === 0, await treeMismatch(bare, 'http://127.0.0.1:' + p));
      await unplant(pl.s);
    }

    /* 1. The port check: a server on any address at the one port the run may use, and the run refuses. Each
          entry of PORT_HOSTS is the only one that sees one of these (measured on macOS, 16 Nov 2026). */
    for (const [label, host, v6only] of [['the wildcard address (what serve.js binds)', undefined], ['the IPv6 wildcard alone', '::', true],
      ['0.0.0.0', '0.0.0.0'], ['127.0.0.1', '127.0.0.1'], ['::1', '::1']]) {
      const p = await freeRun(1);
      const pl = await plant(p, host, OLDER, v6only);
      if (pl.err) {
        ok('(' + label + ' cannot be listened on here: ' + pl.err + ', so there is nothing to stage)', /:/.test(host || '') && (pl.err === 'EADDRNOTAVAIL' || pl.err === 'EAFNOSUPPORT'), pl.err);
        continue;
      }
      const r = await child(tempTree(), [NONE], p + '-' + p).done;
      ok('1. another checkout listening on ' + label + ' at :' + p + ', the only port the run may use: refused before any gate, "no free port"',
        refusedFirst(r) && /no free port/.test(r.out) && pl.s.hits === 0, r.out + '\n(the planted server was asked ' + pl.s.hits + ' times)');
      await unplant(pl.s);
    }

    /* 2. Beside it: the run takes the other port of its band, serves itself there, and never asks the plant. */
    {
      const p = await freeRun(2);
      const pl = await plant(p + 1, undefined, OLDER);
      const r = await child(tempTree(), [NONE], p + '-' + (p + 1)).done;
      ok('2. with the top of a two-port band held on the wildcard address, the run serves THIS tree from :' + p + ' and never asks :' + (p + 1),
        r.code === 0 && new RegExp('serving THIS tree \\(.*\\) at http://127\\.0\\.0\\.1:' + p + '\\b').test(r.out) && /GATES: PASS/.test(r.out) && pl.s.hits === 0,
        r.out + '\n(the planted server was asked ' + pl.s.hits + ' times)');
      await unplant(pl.s);
    }

    /* 3. Its own serve.js must be the one listening. With the picker 72d7c68f had and a server on the wildcard
          address that even serves this tree's own bytes, only that check can see it. On Linux a 127.0.0.1 bind
          beside a wildcard listener fails, so there the old picker already sees it and the run refuses at the pick. */
    for (const [name, files] of [['serving this tree\'s own bytes', APP], ['serving an older checkout (the incident of 16 Nov 2026)', OLDER]]) {
      const p = await freeRun(1);
      const pl = await plant(p, undefined, files);
      const bsd = await portFreeOn(p, '127.0.0.1');
      const r = await child(tempTree({ edit: oldPicker }), [NONE], p + '-' + p).done;
      ok('3. picker as on 72d7c68f, a server on the wildcard address ' + name + ': refused before any gate, '
        + (bsd ? 'because its own serve.js exited on EADDRINUSE' : '(this OS refuses that 127.0.0.1 bind, so the pick itself refuses)'),
        refusedFirst(r) && (bsd ? /exited before it was listening/.test(r.out) && /EADDRINUSE/.test(r.out) : /no free port/.test(r.out)), r.out);
      await unplant(pl.s);
    }

    /* 4. The bytes: a serve.js that is listening and alive but answers for another checkout. */
    {
      const at = SERVE.indexOf('res.end(data);');
      ok('4. (serve.js still ends a file with res.end(data), the line this stage changes)', at >= 0 && SERVE.indexOf('res.end(data);', at + 1) < 0);
      const other = SERVE.replace('res.end(data);', 'res.end(/index\\.html$/.test(fp) ? Buffer.concat([data, Buffer.from(' + JSON.stringify('<!-- an older checkout -->\n') + ')]) : data);');
      const p = await freeRun(1);
      const r = await child(tempTree({ serve: other }), [NONE], p + '-' + p).done;
      ok('4. a serve.js that listens and stays up but serves another checkout\'s app/index.html: refused before any gate, naming the file',
        refusedFirst(r) && /is not THIS tree/.test(r.out) && /app\/index\.html differs/.test(r.out), r.out);
      const q = await freeRun(1);
      const c = await child(tempTree(), [NONE], q + '-' + q).done;
      ok('4. companion: the same run on an unaltered tree serves it, says the three files were checked byte for byte, and passes',
        c.code === 0 && /serving THIS tree/.test(c.out) && /byte for byte/.test(c.out) && /GATES: PASS/.test(c.out), c.out);
    }

    /* 5. The server must last the run: it is killed while a gate runs, and the run fails naming it. */
    {
      const t = tempTree();
      const p = await freeRun(1);
      const c = child(t, ['--only=' + HOLD_GATE], p + '-' + p);   // the hold gate, then the one after it
      const held = await until(() => holdPid(t) > 0, 20000);
      const serve = childrenOf(c.proc.pid).filter((x) => x !== holdPid(t));
      pids.push(holdPid(t), ...serve);
      serve.forEach((x) => { try { process.kill(x, 'SIGKILL'); } catch (e) { /* gone */ } });
      const dead = await until(() => !serve.some(alive), 5000);
      fs.writeFileSync(path.join(t, 'release'), '');
      const r = await c.done;
      ok('5. its serve.js killed while a gate runs: that gate ends, the next one is not started, and the run FAILS (served-tree)',
        held && serve.length === 1 && dead && /self-test-hold\s+ok/.test(r.out) && !/self-test-hold-after/.test(r.out)
          && /served-tree\s+FAIL/.test(r.out) && /exited during the run/.test(r.out) && r.code === 1,
        'serve.js ' + JSON.stringify(serve) + ' dead ' + dead + '\n' + r.out);
    }

    /* 5b. A stranger takes 127.0.0.1 at the run's port while a gate runs, and its own serve.js stays up. macOS lets
           that bind sit beside the run's wildcard serve.js, and 127.0.0.1 is the address the gates ask, so it
           answers whatever is asked after it; the check after the last gate must see its bytes and fail the run.
           On Linux that bind fails beside a wildcard listener (EADDRINUSE), so there is nothing to stage there. */
    {
      const t = tempTree();
      const p = await freeRun(1);
      const c = child(t, ['--only=' + HOLD_GATE], p + '-' + p);
      const held = await until(() => holdPid(t) > 0, 20000);
      const serve = childrenOf(c.proc.pid).filter((x) => x !== holdPid(t));
      pids.push(holdPid(t), ...serve);
      const pl = await plant(p, '127.0.0.1', OLDER);
      fs.writeFileSync(path.join(t, 'release'), '');
      const r = await c.done;
      if (pl.err) {
        ok('5b. (a server on 127.0.0.1:' + p + ' cannot listen beside the run\'s serve.js on this OS: ' + pl.err + ', so there is nothing to stage)',
          process.platform !== 'darwin' && pl.err === 'EADDRINUSE', pl.err + '\n' + r.out);
      } else {
        ok('5b. a server that takes 127.0.0.1:' + p + ' beside the run\'s serve.js while a gate runs, serving an older checkout: the check after the last gate FAILS the run (served-tree), naming app/index.html',
          held && serve.length === 1 && /self-test-hold\s+ok/.test(r.out) && /served-tree\s+FAIL/.test(r.out) && /app\/index\.html differs/.test(r.out) && r.code === 1 && pl.s.hits > 0,
          r.out + '\n(the planted server was asked ' + pl.s.hits + ' times)');
        await unplant(pl.s);
      }
    }

    /* 6. A SIGTERM to the runner alone (what a session stopping a background run sends) takes its server and
          the gate running with it, instead of leaving them behind with PPID 1. */
    {
      const t = tempTree();
      const p = await freeRun(1);
      const c = child(t, ['--only=' + HOLD_GATE], p + '-' + p);
      const held = await until(() => holdPid(t) > 0, 20000);
      const kids = childrenOf(c.proc.pid);
      pids.push(...kids);
      const wasListening = await listening(p);
      c.proc.kill('SIGTERM');
      const r = await c.done;
      const allGone = await until(() => !kids.some(alive), 5000);
      const portFree = await until(async () => !(await listening(p)), 3000);
      ok('6. companion: before the SIGTERM the run was serving on :' + p + ' with its server and the gate as its children', held && wasListening && kids.length === 2, { held, wasListening, kids });
      ok('6. a SIGTERM to the runner alone: it exits 143, its serve.js and the running gate are gone, nothing listens on :' + p,
        r.code === 143 && allGone && portFree, { code: r.code, signal: r.signal, stillAlive: kids.filter(alive), listening: !portFree });
    }

    /* 6b. nightly.sh's watchdog (perl's alarm, then exec) ends a step that runs out of time with SIGALRM, and
           6c. a SIGKILL cannot be caught at all. Each to the runner alone: its serve.js must not outlive it. A
           SIGALRM also reaches the running gate (as a SIGTERM) and the runner exits 142, what nightly_report.js
           reads as the watchdog; after a SIGKILL nothing can tell the gate, so this test lets it go itself. */
    for (const [label, sig] of [['6b. a SIGALRM (nightly.sh\'s watchdog)', 'SIGALRM'], ['6c. a SIGKILL', 'SIGKILL']]) {
      const t = tempTree();
      const p = await freeRun(1);
      const c = child(t, ['--only=' + HOLD_GATE], p + '-' + p);
      const held = await until(() => holdPid(t) > 0, 20000);
      const gate = holdPid(t);
      const serve = childrenOf(c.proc.pid).filter((x) => x !== gate);
      pids.push(gate, ...serve);
      const wasListening = await listening(p);
      c.proc.kill(sig);
      const r = await c.done;
      const serveGone = await until(() => !serve.some(alive), 5000);
      const portFree = await until(async () => !(await listening(p)), 3000);
      const gateGone = await until(() => !alive(gate), 3000);
      fs.writeFileSync(path.join(t, 'release'), '');
      ok(label.slice(0, 3) + ' companion: before the signal the run was serving on :' + p + ' from its own serve.js, a gate running', held && wasListening && serve.length === 1, { held, wasListening, serve, gate });
      if (sig === 'SIGALRM') {
        ok(label + ' to the runner alone: it exits 142, its serve.js and the running gate are gone, nothing listens on :' + p,
          r.code === 142 && serveGone && gateGone && portFree, { code: r.code, signal: r.signal, serveAlive: serve.filter(alive), gateAlive: alive(gate), listening: !portFree });
      } else {
        ok(label + ' to the runner alone: its serve.js exits too, and nothing listens on :' + p,
          r.signal === 'SIGKILL' && serveGone && portFree, { code: r.code, signal: r.signal, serveAlive: serve.filter(alive), listening: !portFree });
      }
    }

    /* 7. The same picker and check, for tools/nightly.sh. */
    if (!RUNNER.includes('--free-ports=') || !RUNNER.includes('--served-is-this-tree=')) ok('7. the runner under test has --free-ports and --served-is-this-tree (not run: an unknown flag would start the whole tree tier)', false);
    else {
      const p = await freeRun(3);
      const pl = await plant(p + 1, undefined, OLDER);
      const r = await child(tempTree(), ['--free-ports=2'], p + '-' + (p + 2)).done;
      ok('7. --free-ports=2 over a band whose middle port is held on the wildcard address prints the other two', r.code === 0 && r.out.trim() === p + ' ' + (p + 2), r.out);
      await unplant(pl.s);
      const t = tempTree();
      const q = await freeRun(1);
      let pq = await plant(q, '127.0.0.1', APP);
      const same = await child(t, ['--served-is-this-tree=http://127.0.0.1:' + q], q + '-' + q).done;
      await unplant(pq.s);
      pq = await plant(q, '127.0.0.1', OLDER);
      const diff = await child(t, ['--served-is-this-tree=http://127.0.0.1:' + q], q + '-' + q).done;
      await unplant(pq.s);
      ok('7. --served-is-this-tree says yes for this tree\'s bytes and no, naming the file, for another checkout\'s',
        same.code === 0 && diff.code === 1 && /app\/index\.html differs/.test(diff.out), same.out + '\n' + diff.out);
    }
  } catch (e) {
    ok('the self-test ran to its end', false, e && e.stack || e);
  } finally {
    for (const s of plants) await unplant(s);
    const left = [...new Set(pids)].filter(alive);
    left.forEach((x) => { try { process.kill(x, 'SIGKILL'); } catch (e) { /* gone */ } });
    if (left.length) console.log('  (killed what a red run left behind: pids ' + left.join(', ') + ')');
    for (const t of made) { try { fs.rmSync(t, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('TREE-SERVER SELF-TEST: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  return fail ? 1 : 0;
}

(async () => {
  if (ARGS.includes('--self-test-downloads')) process.exit(await selfTestDownloads());
  if (ARGS.includes('--self-test-excerpt')) process.exit(selfTestExcerpt());
  if (ARGS.includes('--self-test-tree-server')) process.exit(await selfTestTreeServer());
  /* The same port picker and tree check for another runner (tools/nightly.sh): N free ports, inside
     EMU_PORT_RANGE when set; and whether a URL serves this tree's TREE_PROOF bytes. */
  const freeArg = ARGS.find((a) => a.startsWith('--free-ports='));
  if (freeArg) {
    try { console.log((await freePorts(Number(freeArg.slice(13)) || 1)).join(' ')); process.exit(0); }
    catch (e) { console.error(e.message); process.exit(1); }
  }
  const servedArg = ARGS.find((a) => a.startsWith('--served-is-this-tree='));
  if (servedArg) {
    const bad = await checkTree(ROOT, servedArg.slice(22).replace(/\/$/, ''));
    console.log(bad.length ? 'NOT THIS TREE: ' + bad.join('; ') : 'this tree: ' + TREE_PROOF.join(', ') + ' served byte for byte');
    process.exit(bad.length ? 1 : 0);
  }
  console.log('\nCubby gates');

  /* However this run ends, its tree server goes with it (stopped here, and tethered by TETHER above for the
     ends nothing can catch), and a SIGTERM, SIGHUP or SIGALRM is passed on to the gate running now. A runner
     stopped by a signal used to leave its serve.js listening with PPID 1: the orphans on 7729 and 7739 were
     `node tools/serve.js` by that relative path with PPID 1, as the runner of 72d7c68f started it. SIGALRM is
     what nightly.sh's watchdog sends when a step runs out of time; the gate is given a SIGTERM for it (no gate
     handles SIGALRM), and the runner still exits 142, which nightly_report.js reads as "the watchdog killed
     it". SIGINT is not passed on: Ctrl-C in a terminal already reaches the whole process group. */
  let tree = null;
  const stopServer = () => { if (tree) tree.stop(); };
  process.on('exit', stopServer);
  const onSignal = (n, forward) => {
    stopServer();
    if (forward && runningGate) { try { runningGate.kill(forward); } catch (e) { /* already gone */ } }
    process.exit(128 + n);
  };
  process.on('SIGINT', () => onSignal(2, null));
  process.on('SIGTERM', () => onSignal(15, 'SIGTERM'));
  process.on('SIGHUP', () => onSignal(1, 'SIGHUP'));
  process.on('SIGALRM', () => onSignal(14, 'SIGTERM'));
  try { await startTreeServer(ROOT, await treePort(), (s) => { tree = s; }); }
  catch (e) {
    console.log('REFUSED: ' + e.message + '\nNo gate was run: a gate graded by a server this run cannot vouch for proves nothing about this tree.\n\nGATES: FAIL');
    stopServer();
    process.exit(2);
  }
  const base = tree.base;
  console.log('serving THIS tree (' + ROOT + ') at ' + base + ' (serve.js pid ' + tree.proc.pid + '):');
  console.log(TREE_PROOF.join(', ') + ' are served byte for byte as this tree holds them, checked again after the last gate.');
  console.log('every browser gate is given that URL explicitly, so none of them can grade another checkout.\n');

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
    if (tree.gone) break;   // no gate after the tree server has gone: it would grade another server, or none
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
      if (tree.gone) break;
      process.stdout.write('  ' + g.name.padEnd(18));
      /* Free ports for THIS run (see emuPorts below). A self-hosting suite starts its own emulator and
         web server and reads them from the environment; the rest run inside one we start from a temp
         firebase.json that names them. */
      const ports = await emuPorts();
      const env = emuEnv(ports);
      let r, cfgDir = null;
      /* 'url' is the tree server this run started, as for a tree gate (usage-tracker-emu drives the app there). */
      if (g.self) r = await runGate(g.name, g.self.map((a) => (a === 'url' ? base : a)), ROOT, WATCH, env);
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

  /* The tree server, after the last gate: still up, and still serving this tree's bytes. */
  const treeProblem = tree.gone
    ? 'its serve.js (pid ' + tree.proc.pid + ') exited during the run (' + tree.gone + '): no gate was started after that, and the one running then may have graded another server or none'
    : (await checkTree(ROOT, base)).join('; ');
  stopServer();
  if (treeProblem) {
    const out = 'the tree server at ' + base + ' for ' + ROOT + ': ' + treeProblem;
    results.push({ name: 'served-tree', ok: false, ms: 0, out });
    console.log('  ' + 'served-tree'.padEnd(18) + 'FAIL  ' + out.slice(0, 160));
  }
  const failed = results.filter((r) => !r.ok);
  const blocking = failed.filter((r) => !r.live);
  console.log('\n' + '-'.repeat(72));
  console.log(results.length + ' gates, ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');

  if (failed.length) {
    console.log('\nfull output from what failed:');
    failed.forEach((f) => {
      console.log('\n=== ' + f.name + ' ===');
      console.log(excerpt(f.out)); // head, tail, and every FAIL with its detail (excerpt, above)
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
