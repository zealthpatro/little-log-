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
 *   node tools/gates.js --all
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
const LIVE = has('--live'), EMU = has('--emulator');
// CI runs on Linux without the Mac Chrome these gates drive, so it takes the Chrome-free subset.
// That is still 6 gates more than ran automatically before this file existed.
const NO_BROWSER = ARGS.includes('--no-browser');
const ONLY = (ARGS.find((a) => a.startsWith('--only=')) || '').slice(7);

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
  { name: 'preg-session',   cmd: ['node', 'tools/preg_session_resume_check.js', 'url'] },
  { name: 'support-reach',  cmd: ['node', 'tools/support_reach_check.js', 'url'] },
  { name: 'vax-calendar',   cmd: ['node', 'tools/vax_calendar_check.js', 'url'] },
  { name: 'homelogs',       cmd: ['node', 'tools/homelogs_gate.js', 'url'] },
  { name: 'offline',        cmd: ['node', 'tools/offline_gate.js', 'url'] },
  { name: 'sitesw',         cmd: ['node', 'tools/sitesw_gate.js', 'url'] },
  { name: 'stack',          cmd: ['node', 'tools/stack_check.js', 'url'] },
  { name: 'pad',            cmd: ['node', 'tools/pad_audit.js', 'url'] },
  { name: 'blob-clobber',   cmd: ['node', 'test/blob-clobber.test.js'] },
  { name: 'dose-ticket',    cmd: ['node', 'test/dose-ticket.test.js'] },
  { name: 'push-delivery',  cmd: ['node', 'test/push-delivery.test.js'] },
  { name: 'signin-canary',  cmd: ['node', 'test/signin-canary.test.js'] },
  /* The funnel: derivation, Worker, client, and the plan they all answer to. Each proven red. */
  { name: 'funnel-core',    cmd: ['node', 'test/funnel-core.test.js'] },
  { name: 'funnel-worker',  cmd: ['node', 'test/funnel-worker.test.js'] },
  { name: 'funnel-steps',   cmd: ['node', 'tools/funnel_steps_check.js', 'url'] },
  { name: 'tracking-plan',  cmd: ['node', 'tools/tracking_plan_check.js'] },
  { name: 'funnel-report',  cmd: ['node', 'tools/funnel_report.js', '--self-test'] },
  { name: 'signin-email',   cmd: ['node', 'test/signin-email.test.js', '--self-test'] },
  { name: 'signin-flow',    cmd: ['node', 'test/signin-flow.test.js', '--self-test'] },
  { name: 'signin-boot',    cmd: ['node', 'test/signin-boot.test.js', '--self-test'] },
  { name: 'push-caps',      cmd: ['node', 'test/push-caps.test.js'] },
  { name: 'duedate-cycle',  cmd: ['node', 'test/duedate-cycle.test.js', 'url'] },
  { name: 'fab-quicklog',   cmd: ['node', 'test/fab-quicklog.test.js', 'url'] },
];
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
];
/* These need a real Firestore emulator, so they cannot run in the tree tier. loss-archive and
   push-query drive the app or the Worker's query against it rather than testing rules, which is
   why they live in test/ and still belong here. loss-archive binds its own ports (8181 emulator,
   8080 web) and starts what it needs itself. */
const EMU_GATES = [
  { name: 'rules',        emu: 'node rules-test.js' },
  { name: 'invite-link',  emu: 'node invite-link.test.js' },
  { name: 'push-query',   emu: 'node push-query.test.js' },
  { name: 'claim-rules',  emu: 'node signin-claim-rules.test.js' },
  { name: 'consent-blast',emu: 'node consent-blast.test.js' },
  { name: 'invite-join',  emu: 'node invite-join.test.js' },
  { name: 'loss-leak',    emu: 'node loss-leak.test.js' },
  { name: 'loss-archive', self: ['node', 'test/loss-archive-reload.test.js'] },
];

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
function run(cmd, cwd) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(cmd[0], cmd.slice(1), { cwd: cwd || ROOT, env: process.env });
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
async function runGate(name, cmd, cwd, watch) {
  const before = dl.snapshot(watch);
  const r = await run(cmd, cwd);
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
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  console.log('\nCubby gates');
  console.log('serving THIS tree (' + ROOT + ') at ' + base);
  console.log('every browser gate is given that URL explicitly, so none of them can grade another checkout.\n');

  const server = spawn('node', ['tools/serve.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port) }), stdio: 'ignore' });
  const stopServer = () => { try { server.kill(); } catch (e) {} };
  process.on('exit', stopServer);
  process.on('SIGINT', () => { stopServer(); process.exit(130); });
  try { await waitFor(base + '/app/', 15000); }
  catch (e) { console.error('could not start the local server: ' + e.message); stopServer(); process.exit(2); }

  let list = TREE.slice();
  if (LIVE) list = list.concat(LIVE_GATES);
  if (NO_BROWSER) list = list.filter((g) => !g.cmd.includes('url'));
  if (ONLY) list = list.filter((g) => g.name.includes(ONLY));

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
    console.log('\n  firestore emulator');
    for (const g of EMU_GATES) {
      process.stdout.write('  ' + g.name.padEnd(18));
      // A self-hosting suite starts its own emulator and web server; the rest run inside one.
      const r = g.self
        ? await runGate(g.name, g.self, ROOT, WATCH)
        : await runGate(g.name, ['npx', 'firebase-tools', 'emulators:exec', '--only', 'firestore', '--project', 'demo-cubby', g.emu], path.join(ROOT, 'test'), WATCH);
      results.push({ name: g.name, ok: r.code === 0, ms: r.ms, out: r.out });
      console.log((r.code === 0 ? 'ok  ' : 'FAIL') + '  ' + String((r.ms / 1000).toFixed(1) + 's').padStart(7) + '  ' + (r.downloads ? r.downloads.split('\n')[0] : gist(r.out, r.code === 0)));
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
