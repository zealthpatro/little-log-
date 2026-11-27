/* Does .githooks/pre-push run one push suite at a time on this machine?
 *
 *   node test/push-lock.test.js
 *
 * WHY. On 27 Nov 2026 two pushes ran their suites at once on this Mac. They took each other's ports and
 * the tree-server self-test failed (case 7, "has no 2 free ports"), a failure neither run had alone. The
 * hook now runs under a machine lock (a kernel flock on one file, CUBBY_PUSH_LOCK, default
 * ~/.cache/cubby/push.flock). Since 28 Nov 2026 a branch push runs no gates (CI runs them on the PR) and a
 * push to main is refused before the lock, so what the lock holds is the hook's one remaining job,
 * tools/change_test_check.js. The first version was a mkdir lock with a pid in it, and a skeptic broke it
 * three ways: six waiters behind a dead holder all "took it over" and ran together (22 of 30 trials), a lock
 * left with no name in it was waited on forever, and a lock path that could not be made was waited on
 * forever too. A flock has no stale state: the kernel lets it go when its holder dies, even on SIGKILL.
 *
 * This stages, in a throwaway repo with the REAL hook and a stub tools/change_test_check.js that records
 * what it saw: no holder, a live holder (waited for, named), a holder killed with SIGKILL (taken at once), a
 * lock left with no name in it, a failing check (still released), two pushes at once, six pushes at once
 * behind a SIGKILLed holder (five rounds, never two at once), a lock path that cannot be made (fails fast,
 * naming it), a check that leaves an orphan behind (the orphan does not keep the lock), a push started by a
 * job that already holds the lock (runs at once, no deadlock on its own parent), and a push to main (refused
 * before the lock, never waiting behind a holder).
 * Every holder is a real hook run, never a hand-made lock, so the same cases grade any lock design.
 * The lock is always under a temp dir here, never the real one.
 *
 *   PREPUSH_HOOK=/path/to/old/pre-push node test/push-lock.test.js   grade another hook (the red run)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');

/* Before any git: a hook exports GIT_DIR, which from a linked worktree names the SHARED repository. And this
   suite usually runs inside a real push, which holds the real lock and says so in CUBBY_PUSH_LOCK_HELD. */
for (const k of Object.keys(process.env)) if (/^GIT_/.test(k) || /^CUBBY_PUSH_LOCK/.test(k)) delete process.env[k];

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 900).replace(/\n/g, '\n         ') : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-pushlock-'));
const W = path.join(T, 'work');
const LOCK = path.join(T, 'cache', 'cubby', 'push.flock');
const CALLS = path.join(T, 'check-calls.txt');
const STARTS = path.join(T, 'check-starts.txt');
const ORPHANS = path.join(T, 'orphans.txt');
const git = (args) => execFileSync('git', args, { cwd: W, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(W, p)), { recursive: true }); fs.writeFileSync(path.join(W, p), s); };

fs.mkdirSync(W);
git(['init', '-q', '-b', 'main']);
git(['config', 'user.email', 'pushlock@example.test']); git(['config', 'user.name', 'push lock test']); git(['config', 'commit.gpgsign', 'false']);
w('.githooks/pre-push', fs.readFileSync(process.env.PREPUSH_HOOK || path.join(ROOT, '.githooks', 'pre-push'), 'utf8'));
fs.chmodSync(path.join(W, '.githooks', 'pre-push'), 0o755);
/* The stub change_test_check.js: reads git's stdin as the real one does, notes when it starts, then after
   STUB_SLEEP_MS records the lock's name line as it saw it and when it ran, and fails when STUB_CHECK_FAIL is
   set. It reads the lock wherever the hook keeps the name: in the lock file, or (the old mkdir lock) in an
   owner file inside it. STUB_ORPHAN leaves a detached `sleep 30` behind, as a leaked process would. */
w('tools/change_test_check.js', "const fs = require('fs'), t0 = Date.now(), L2 = process.env.CUBBY_PUSH_LOCK; try { fs.readFileSync(0); } catch (e) {}\n"
  + "const read = () => { try { return fs.readFileSync(L2, 'utf8').trim(); } catch (e) { try { return fs.readFileSync(L2 + '/owner', 'utf8').trim(); } catch (e2) { return null; } } };\n"
  + "fs.appendFileSync(" + JSON.stringify(STARTS) + ", process.pid + '\\n');\n"
  + "if (process.env.STUB_ORPHAN) { const c = require('child_process').spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }); c.unref(); fs.appendFileSync(" + JSON.stringify(ORPHANS) + ", c.pid + '\\n'); }\n"
  + "const owner = read();\n"
  + "setTimeout(() => { fs.appendFileSync(" + JSON.stringify(CALLS) + ", JSON.stringify({ args: process.argv.slice(2), owner, t0, t1: Date.now(), held: process.env.CUBBY_PUSH_LOCK_HELD || null }) + '\\n');\n"
  + "  process.exit(process.env.STUB_CHECK_FAIL ? 1 : 0); }, Number(process.env.STUB_SLEEP_MS || 0));\n");
w('README.md', 'x\n');
w('.gitignore', 'tools/node_modules\ntest/node_modules\n');
git(['add', '-A']); git(['commit', '-q', '-m', 'root']);
fs.mkdirSync(path.join(W, 'tools', 'node_modules'), { recursive: true }); fs.mkdirSync(path.join(W, 'test', 'node_modules'), { recursive: true });
const root = git(['rev-parse', 'HEAD']);
w('docs/notes.md', 'words\n'); git(['add', 'docs/notes.md']); git(['commit', '-q', '-m', 'docs']);
const docs = git(['rev-parse', 'HEAD']);
/* A branch push: a push to main is refused before the lock is ever taken (case 10 below). */
const LINE = 'refs/heads/feature ' + docs + ' refs/heads/feature ' + root + '\n';
/* Which shape of lock the hook under test keeps, only so 3b can stage the nameless lock THAT hook would leave. */
const MKDIR_LOCK = /until mkdir "\$PUSH_LOCK"/.test(fs.readFileSync(path.join(W, '.githooks', 'pre-push'), 'utf8'));

const lines = (f) => { try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean); } catch (e) { return []; } };
const calls = () => lines(CALLS).map((l) => JSON.parse(l));
/* Each case starts from no lock at all, so one hook's leftover cannot poison the cases after it (the red run on
   the mkdir lock waited 60 s in every case after 3b). Nothing holds the lock between cases. */
const reset = () => { for (const f of [CALLS, STARTS]) { try { fs.unlinkSync(f); } catch (e) { /* none yet */ } } fs.rmSync(LOCK, { recursive: true, force: true }); };
/* Is the lock held RIGHT NOW? Asked the way a waiter would: a flock taken without blocking. An old mkdir
   lock is held while its directory exists. */
const PROBE = 'use Fcntl ":flock"; open(my $f, ">>", $ARGV[0]) or exit 2; exit(flock($f, LOCK_EX | LOCK_NB) ? 0 : 1);';
function lockHeld(p) {
  p = p || LOCK;
  if (!fs.existsSync(p)) return false;
  if (fs.statSync(p).isDirectory()) return true;
  return spawnSync('perl', ['-e', PROBE, p]).status !== 0;
}
/* Every check window [t0, t1] after another's end: no two pushes ran their checks at once. */
const serial = (c) => { const s = c.slice().sort((x, y) => x.t0 - y.t0); for (let i = 1; i < s.length; i++) if (s[i].t0 < s[i - 1].t1) return false; return true; };
const maxAtOnce = (c) => { let m = 0; for (const a of c) m = Math.max(m, c.filter((b) => b.t0 < a.t1 && a.t0 < b.t1).length); return m; };
/* One hook run, started now, in a process group of its own (so a test can SIGKILL the whole push); .done
   resolves with its exit and output. Killed after `limit` ms (60 s) so nothing hangs. */
const live = new Set();
function hook(env, limit, hold, line) {
  const p = spawn('sh', [path.join(W, '.githooks', 'pre-push'), 'origin', 'nowhere'], { cwd: W, detached: true,
    env: Object.assign({}, process.env, { CUBBY_PUSH_LOCK: LOCK, CUBBY_PUSH_LOCK_POLL: '1' }, env || {}) });
  live.add(p.pid);
  const h = { pid: p.pid, out: '', exited: false };
  p.stdout.on('data', (d) => { h.out += d; }); p.stderr.on('data', (d) => { h.out += d; });
  const timer = setTimeout(() => { h.out += '\n[test: still running after ' + (limit || 60000) / 1000 + ' s, killed]'; h.timedOut = true; try { process.kill(-p.pid, 'SIGKILL'); } catch (e) { /* gone */ } }, limit || 60000);
  h.done = new Promise((res) => p.on('close', (code) => { clearTimeout(timer); h.exited = true; live.delete(p.pid); res({ code, out: h.out, timedOut: !!h.timedOut }); }));
  h.killGroup = () => { try { process.kill(-p.pid, 'SIGKILL'); } catch (e) { /* gone */ } };
  /* hold: git's stdin is fed later, by h.go(). The hook reads it before anything else, so pushes fed in one
     tick reach the lock as close together as a process start allows. */
  h.go = () => p.stdin.end(line || LINE);
  if (!hold) h.go();
  return h;
}
async function until(f, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await sleep(50); } return f(); }
/* A push killed with SIGKILL while its check ran, the whole process group at once: whatever state that leaves. */
async function killedPush() {
  const before = lines(STARTS).length;
  const k = hook({ STUB_SLEEP_MS: '30000' });
  const started = await until(() => lines(STARTS).length > before, 15000);
  k.killGroup();
  await k.done;
  return { pid: k.pid, started };
}

(async () => {
  console.log('\npre-push: one push suite at a time on this machine (lock ' + LOCK + ')\n');
  try {
    /* 1. Nobody holds it: the check runs holding it, as this hook's own pid, and it is free afterwards. */
    reset();
    let h = hook();
    let r = await h.done;
    let c = calls();
    ok('1. with no holder the check runs at once, and the push passes with "no gates run here"', r.code === 0 && c.length === 1 && /no gates run here/.test(r.out), r.out);
    ok('1. while they run, the lock is held in this hook\'s name ("' + h.pid + ' work main")', c.length === 1 && c[0].owner === h.pid + ' work main', JSON.stringify(c));
    ok('1. and it is free when the hook exits', !lockHeld(), LOCK);

    /* 2. A live holder (another push, mid-check): waited for, naming it, and the check runs once it is done. */
    reset();
    const a = hook({ STUB_SLEEP_MS: '4000' });
    await until(() => lines(STARTS).length === 1, 15000);
    h = hook();
    await sleep(2000);
    ok('2. a live holder: 2 s later the second push is still waiting and has not run the check', !h.exited && lines(STARTS).length === 1, h.out);
    ok('2. and it says whom it waits for ("' + a.pid + ' work main")', /Waiting for another push on this machine/.test(h.out) && h.out.includes(a.pid + ' work main'), h.out);
    const [ra2, r2] = await Promise.all([a.done, h.done]);
    c = calls();
    ok('2. once the holder is done the second push takes the lock and its check runs after the first one\'s',
      ra2.code === 0 && r2.code === 0 && c.length === 2 && serial(c) && c[1].owner === h.pid + ' work main', r2.out + '\n' + JSON.stringify(c));
    ok('2. and it is free afterwards', !lockHeld(), LOCK);

    /* 3. A holder killed with SIGKILL mid-check (no trap runs): the next push runs at once, without waiting. */
    reset();
    let k = await killedPush();
    const t0 = Date.now();
    r = await hook().done;
    c = calls();
    ok('3. after a push was SIGKILLed mid-check, the next push runs at once and never waits',
      k.started && r.code === 0 && c.length === 1 && Date.now() - t0 < 10000 && !/Waiting for another push/.test(r.out), r.out + '\n' + JSON.stringify(c));
    ok('3. and it is free afterwards', !lockHeld(), LOCK);

    /* 3b. A lock with no name in it (a push killed between taking it and naming itself): not waited on. */
    reset();
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    if (MKDIR_LOCK) { fs.mkdirSync(LOCK, { recursive: true }); for (const f of fs.readdirSync(LOCK)) fs.unlinkSync(path.join(LOCK, f)); } else fs.writeFileSync(LOCK, '');
    r = await hook(null, 12000).done;
    ok('3b. a lock left with no name in it is not waited on: the push runs within 12 s', !r.timedOut && r.code === 0 && calls().length === 1, r.out);

    /* 4. A failing check stops the push and still lets the lock go. */
    reset();
    r = await hook({ STUB_GATES_FAIL: '1' }).done;
    ok('4. a failing change-test check stops the push and the lock is free afterwards', r.code === 1 && /Push stopped: product code changed/.test(r.out) && !lockHeld(), r.out);

    /* 5. Two pushes at once: their checks never overlap. */
    reset();
    const p1 = hook({ STUB_SLEEP_MS: '2500' }), p2 = hook({ STUB_SLEEP_MS: '2500' });
    const [rp1, rp2] = await Promise.all([p1.done, p2.done]);
    c = calls();
    ok('5. two pushes started together both pass and each ran its check once', rp1.code === 0 && rp2.code === 0 && c.length === 2, rp1.out + '\n' + rp2.out + '\n' + JSON.stringify(c));
    ok('5. and the second one\'s check started only after the first one\'s ended', c.length === 2 && serial(c) && c[0].owner !== c[1].owner, JSON.stringify(c));
    ok('5. and the lock is free after both', !lockHeld(), LOCK);

    /* 6. Six pushes started together behind a push that was SIGKILLed mid-check, five rounds: the mkdir lock
          let every waiter "take over" the dead one, and up to three ran at once. Never two here. */
    let worst = 0, all6 = true, out6 = '';
    for (let round = 0; round < 5; round++) {
      reset();
      k = await killedPush();
      const hs = []; for (let i = 0; i < 6; i++) hs.push(hook({ STUB_SLEEP_MS: '300' }, 60000, true));
      await sleep(500);
      for (const x of hs) x.go();
      const rs = await Promise.all(hs.map((x) => x.done));
      c = calls();
      worst = Math.max(worst, maxAtOnce(c));
      if (!(k.started && rs.every((x) => x.code === 0) && c.length === 6)) { all6 = false; out6 += rs.map((x) => x.out).join('\n---\n') + '\n' + JSON.stringify(c) + '\n'; }
    }
    ok('6. six pushes behind a SIGKILLed holder, five rounds: every push passes and runs its check once', all6, out6);
    ok('6. and no two of them ever ran their checks at the same time (at most ' + worst + ' at once)', worst === 1, 'at most ' + worst + ' at once');
    ok('6. and the lock is free afterwards', !lockHeld(), LOCK);

    /* 7. A lock path that cannot be made (its parent is a file, not a directory: true even for root) stops the
          push within seconds, naming the path, instead of waiting forever. */
    reset();
    const blocker = path.join(T, 'not-a-dir');
    fs.writeFileSync(blocker, 'x\n');
    const BAD = path.join(blocker, 'cubby', 'push.flock');
    r = await hook({ CUBBY_PUSH_LOCK: BAD }, 12000).done;
    ok('7. a lock path that cannot be made stops the push within 12 s, naming the path, and runs no check',
      !r.timedOut && r.code !== 0 && r.out.includes(BAD) && calls().length === 0, r.out);

    /* 8. A check that leaves an orphan behind (a leaked process): the orphan does not keep the lock, or every
          later push would wait on it with nobody to say why. */
    reset();
    r = await hook({ STUB_ORPHAN: '1' }).done;
    const orphan = Number(lines(ORPHANS).slice(-1)[0]);
    let orphanAlive = false; try { process.kill(orphan, 0); orphanAlive = true; } catch (e) { /* gone */ }
    ok('8. a check\'s orphan outlives the push (the stage is real) and the lock is free all the same', r.code === 0 && orphanAlive && !lockHeld(), r.out + ' orphan ' + orphan + ' alive=' + orphanAlive);

    /* 9. A push started by a job that already holds this lock (a queued job that pushes, e.g. the train) says
          CUBBY_PUSH_LOCK_HELD=<this lock>: it runs at once instead of waiting forever on its own parent.
          Companion: the same push without the marker does wait. */
    reset();
    const outer = hook({ STUB_SLEEP_MS: '6000' });
    await until(() => lines(STARTS).length === 1, 15000);
    const nested = hook({ CUBBY_PUSH_LOCK_HELD: LOCK }, 5000), stranger = hook({ STUB_SLEEP_MS: '0' });
    const rn = await nested.done;
    ok('9. a push inside a job that holds this lock runs at once (within 5 s, while the holder still runs)', !rn.timedOut && rn.code === 0 && !/Waiting for another push/.test(rn.out) && !outer.exited, rn.out);
    ok('9. companion: a push without the marker started beside it is still waiting', !stranger.exited && /Waiting for another push/.test(stranger.out), stranger.out);
    await Promise.all([outer.done, stranger.done]);
    ok('9. and the lock is free afterwards', !lockHeld(), LOCK);

    /* 10. A push to main is refused before the lock: with a live holder mid-check it is refused at once, never
           waits, never runs the check, and leaves the holder's lock as it was. */
    reset();
    const holder10 = hook({ STUB_SLEEP_MS: '6000' });
    await until(() => lines(STARTS).length === 1, 15000);
    const t10 = Date.now();
    const rm = await hook(null, 10000, false, 'refs/heads/main ' + docs + ' refs/heads/main ' + root + '\n').done;
    ok('10. a push to main, with a live holder, is refused at once (within 5 s) without waiting for the lock or running the check',
      !rm.timedOut && rm.code === 1 && /This push targets main/.test(rm.out) && !/Waiting for another push/.test(rm.out) && Date.now() - t10 < 5000 && lines(STARTS).length === 1, rm.out);
    ok('10. and the holder still holds the lock in its own name', !holder10.exited && lockHeld() && (() => { try { return fs.readFileSync(LOCK, 'utf8').trim(); } catch (e) { try { return fs.readFileSync(path.join(LOCK, 'owner'), 'utf8').trim(); } catch (e2) { return null; } } })() === holder10.pid + ' work main', LOCK);
    await holder10.done;
    ok('10. and the lock is free once the holder is done', !lockHeld(), LOCK);
  } catch (e) {
    ok('the test ran to its end', false, e && e.stack || e);
  } finally {
    for (const p of live) { try { process.kill(-p, 'SIGKILL'); } catch (e) { /* gone */ } }
    for (const p of lines(ORPHANS)) { try { process.kill(Number(p), 'SIGKILL'); } catch (e) { /* gone */ } }
    try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('PUSH-LOCK: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})();
