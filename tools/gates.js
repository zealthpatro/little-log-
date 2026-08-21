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
  { name: 'type',           cmd: ['node', 'tools/type_check.js', 'url'] },
  { name: 'grid',           cmd: ['node', 'tools/grid_check.js'] },
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
  { name: 'signin-email',   cmd: ['node', 'test/signin-email.test.js', '--self-test'] },
  { name: 'push-caps',      cmd: ['node', 'test/push-caps.test.js'] },
  { name: 'duedate-cycle',  cmd: ['node', 'test/duedate-cycle.test.js', 'url'] },
  { name: 'fab-quicklog',   cmd: ['node', 'test/fab-quicklog.test.js', 'url'] },
];
// These judge PRODUCTION, not this checkout, so a failure is a deploy problem rather than a code
// problem. Opt-in, because they need the network and they are the founder's to act on.
const LIVE_GATES = [
  { name: 'thirdparty(live)', cmd: ['node', 'tools/thirdparty_gate.js'] },
  { name: 'claims(live)',     cmd: ['node', 'tools/claims_audit.js', 'url'] },
];
/* These need a real Firestore emulator, so they cannot run in the tree tier. loss-archive and
   push-query drive the app or the Worker's query against it rather than testing rules, which is
   why they live in test/ and still belong here. loss-archive binds its own ports (8181 emulator,
   8080 web) and starts what it needs itself. */
const EMU_GATES = [
  { name: 'rules',        emu: 'node rules-test.js' },
  { name: 'invite-link',  emu: 'node invite-link.test.js' },
  { name: 'push-query',   emu: 'node push-query.test.js' },
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

(async () => {
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

  const results = [];
  for (const g of list) {
    const cmd = g.cmd.map((a) => (a === 'url' ? base : a));
    process.stdout.write('  ' + g.name.padEnd(18));
    const r = await run(cmd);
    const okRun = r.code === 0;
    results.push({ name: g.name, ok: okRun, live: g.name.includes('(live)'), ms: r.ms, out: r.out });
    console.log((okRun ? 'ok  ' : 'FAIL') + '  ' + String((r.ms / 1000).toFixed(1) + 's').padStart(7) + '  ' + gist(r.out, okRun));
  }

  if (EMU) {
    console.log('\n  firestore emulator');
    for (const g of EMU_GATES) {
      process.stdout.write('  ' + g.name.padEnd(18));
      // A self-hosting suite starts its own emulator and web server; the rest run inside one.
      const r = g.self
        ? await run(g.self)
        : await run(['npx', 'firebase-tools', 'emulators:exec', '--only', 'firestore', '--project', 'demo-cubby', g.emu], path.join(ROOT, 'test'));
      results.push({ name: g.name, ok: r.code === 0, ms: r.ms, out: r.out });
      console.log((r.code === 0 ? 'ok  ' : 'FAIL') + '  ' + String((r.ms / 1000).toFixed(1) + 's').padStart(7) + '  ' + gist(r.out, r.code === 0));
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
      console.log(f.out.split('\n').slice(-25).join('\n'));
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
