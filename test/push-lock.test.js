/* Does .githooks/pre-push run one push suite at a time on this machine?
 *
 *   node test/push-lock.test.js
 *
 * WHY. On 27 Nov 2026 two pushes ran their suites at once on this Mac. They took each other's ports and
 * the tree-server self-test failed (case 7, "has no 2 free ports"), a failure neither run had alone. The
 * hook now takes a machine lock (a directory, CUBBY_PUSH_LOCK, default ~/.cache/cubby/push.lock) before its
 * gates and lets it go when it exits. This stages, in a throwaway repo with the REAL hook and a stub
 * tools/gates.js that records what it saw: no holder, a live holder (waited for), a dead holder (taken
 * over), a failing gate (still released), and two pushes at once (their gates never overlap).
 * The lock is always a temp dir here, never the real one.
 *
 *   PREPUSH_HOOK=/path/to/old/pre-push node test/push-lock.test.js   grade another hook (the red run)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');

/* Before any git: a hook exports GIT_DIR, which from a linked worktree names the SHARED repository. */
for (const k of Object.keys(process.env)) if (/^GIT_/.test(k)) delete process.env[k];

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 900).replace(/\n/g, '\n         ') : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-pushlock-'));
const W = path.join(T, 'work');
const LOCK = path.join(T, 'cache', 'cubby', 'push.lock');
const CALLS = path.join(T, 'gates-calls.txt');
const git = (args) => execFileSync('git', args, { cwd: W, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(W, p)), { recursive: true }); fs.writeFileSync(path.join(W, p), s); };

fs.mkdirSync(W);
git(['init', '-q', '-b', 'main']);
git(['config', 'user.email', 'pushlock@example.test']); git(['config', 'user.name', 'push lock test']); git(['config', 'commit.gpgsign', 'false']);
w('.githooks/pre-push', fs.readFileSync(process.env.PREPUSH_HOOK || path.join(ROOT, '.githooks', 'pre-push'), 'utf8'));
fs.chmodSync(path.join(W, '.githooks', 'pre-push'), 0o755);
w('tools/change_test_check.js', fs.readFileSync(path.join(ROOT, 'tools', 'change_test_check.js'), 'utf8'));
/* The stub: records the lock's owner line as its gates saw it and when they ran, after STUB_SLEEP_MS. */
w('tools/gates.js', "const fs = require('fs'), t0 = Date.now();\n"
  + "let owner = null; try { owner = fs.readFileSync(" + JSON.stringify(path.join(LOCK, 'owner')) + ", 'utf8').trim(); } catch (e) {}\n"
  + "setTimeout(() => { fs.appendFileSync(" + JSON.stringify(CALLS) + ", JSON.stringify({ args: process.argv.slice(2), owner, t0, t1: Date.now() }) + '\\n');\n"
  + "  process.exit(process.env.STUB_GATES_FAIL ? 1 : 0); }, Number(process.env.STUB_SLEEP_MS || 0));\n");
w('README.md', 'x\n');
w('.gitignore', 'tools/node_modules\ntest/node_modules\n');
git(['add', '-A']); git(['commit', '-q', '-m', 'root']);
fs.mkdirSync(path.join(W, 'tools', 'node_modules'), { recursive: true }); fs.mkdirSync(path.join(W, 'test', 'node_modules'), { recursive: true });
const root = git(['rev-parse', 'HEAD']);
w('docs/notes.md', 'words\n'); git(['add', 'docs/notes.md']); git(['commit', '-q', '-m', 'docs']);
const docs = git(['rev-parse', 'HEAD']);
const LINE = 'refs/heads/main ' + docs + ' refs/heads/main ' + root + '\n';

const calls = () => { try { return fs.readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } };
const reset = () => { try { fs.unlinkSync(CALLS); } catch (e) { /* none yet */ } };
const lockHeld = () => fs.existsSync(LOCK);
/* One hook run, started now; .done resolves with its exit and output. Killed after 60 s so nothing hangs. */
function hook(env) {
  const p = spawn('sh', [path.join(W, '.githooks', 'pre-push'), 'origin', 'nowhere'], { cwd: W,
    env: Object.assign({}, process.env, { CUBBY_PUSH_LOCK: LOCK, CUBBY_PUSH_LOCK_POLL: '1' }, env || {}) });
  const h = { pid: p.pid, out: '', exited: false };
  p.stdout.on('data', (d) => { h.out += d; }); p.stderr.on('data', (d) => { h.out += d; });
  const timer = setTimeout(() => { h.out += '\n[test: still running after 60 s, killed]'; p.kill('SIGKILL'); }, 60000);
  h.done = new Promise((res) => p.on('close', (code) => { clearTimeout(timer); h.exited = true; res({ code, out: h.out }); }));
  p.stdin.end(LINE);
  return h;
}
const holdWith = (pid, name) => { fs.mkdirSync(LOCK, { recursive: true }); fs.writeFileSync(path.join(LOCK, 'owner'), pid + ' ' + name + '\n'); };
const pids = [];

(async () => {
  console.log('\npre-push: one push suite at a time on this machine (lock ' + LOCK + ')\n');
  try {
    /* 1. Nobody holds it: the gates run holding it, as this hook's own pid, and it is gone afterwards. */
    reset();
    let h = hook();
    let r = await h.done;
    let c = calls();
    ok('1. with no holder the gates run at once, and the hook still says "Running gates before push"', r.code === 0 && c.length === 1 && /Running gates before push/.test(r.out), r.out);
    ok('1. while they run, the lock is held in this hook\'s name ("' + h.pid + ' ...")', c.length === 1 && typeof c[0].owner === 'string' && c[0].owner.split(' ')[0] === String(h.pid), JSON.stringify(c));
    ok('1. and it is released when the hook exits', !lockHeld(), LOCK);

    /* 2. A live holder: waited for, saying so, until it is gone; then taken over and the gates run. */
    reset();
    const holder = spawn('sleep', ['60']);
    pids.push(holder.pid);
    holdWith(holder.pid, 'another-push main');
    h = hook();
    await sleep(3500);
    const waiting = !h.exited && calls().length === 0;
    ok('2. a live holder: after 3.5 s the hook is still waiting and no gate has run', waiting, h.out);
    ok('2. and it says whom it waits for', /Waiting for another push on this machine/.test(h.out) && h.out.includes(holder.pid + ' another-push main'), h.out);
    holder.kill('SIGKILL');
    r = await h.done;
    c = calls();
    ok('2. once the holder is gone it takes the lock and the gates run', r.code === 0 && c.length === 1 && c[0].owner && c[0].owner.split(' ')[0] === String(h.pid), r.out + '\n' + JSON.stringify(c));
    ok('2. and releases it', !lockHeld(), LOCK);

    /* 3. A dead holder from the start (a push that was killed): taken over at once, saying so. */
    reset();
    const gone = spawnSync('true').pid;
    holdWith(gone, 'killed-push main');
    const t0 = Date.now();
    h = hook();
    r = await h.done;
    c = calls();
    ok('3. a holder whose pid is not running is taken over without waiting, and the gates run as this hook',
      r.code === 0 && c.length === 1 && c[0].owner && c[0].owner.split(' ')[0] === String(h.pid) && Date.now() - t0 < 10000 && !/Waiting for another push/.test(r.out), r.out + '\n' + JSON.stringify(c));
    ok('3. naming the holder it took it from', /no longer running/.test(r.out) && r.out.includes(gone + ' killed-push main'), r.out);
    ok('3. and releases it', !lockHeld(), LOCK);

    /* 4. A failing gate stops the push and still lets the lock go. */
    reset();
    r = await hook({ STUB_GATES_FAIL: '1' }).done;
    ok('4. a failing gate stops the push and the lock is released', r.code === 1 && /Push stopped: a gate failed/.test(r.out) && !lockHeld(), r.out);

    /* 5. Two pushes at once: their gates never overlap. */
    reset();
    const a = hook({ STUB_SLEEP_MS: '2500' }), b = hook({ STUB_SLEEP_MS: '2500' });
    const [ra, rb] = await Promise.all([a.done, b.done]);
    c = calls().sort((x, y) => x.t0 - y.t0);
    ok('5. two pushes started together both pass and each ran its gates once', ra.code === 0 && rb.code === 0 && c.length === 2, ra.out + '\n' + rb.out + '\n' + JSON.stringify(c));
    ok('5. and the second one\'s gates started only after the first one\'s ended', c.length === 2 && c[1].t0 >= c[0].t1 && c[0].owner !== c[1].owner, JSON.stringify(c));
    ok('5. and the lock is released after both', !lockHeld(), LOCK);
  } catch (e) {
    ok('the test ran to its end', false, e && e.stack || e);
  } finally {
    for (const p of pids) { try { process.kill(p, 'SIGKILL'); } catch (e) { /* gone */ } }
    try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('PUSH-LOCK: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})();
