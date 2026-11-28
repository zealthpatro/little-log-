/* A push from a LINKED worktree leaves the repository it shares exactly as it was.
 *
 *   node test/prepush-worktree.test.js
 *   PREPUSH_WT_FROM=/path/to/other/checkout node test/prepush-worktree.test.js   grade another tree's
 *     hook, runner and self-tests (the red run: the Nov 2026 branch before the fix fails here)
 *
 * WHY. Inside a hook git exports GIT_DIR (and, in a linked worktree, it points into the SHARED
 * repository: <repo>/.git/worktrees/<name>). tools/gates.js handed its whole environment to every gate,
 * and two of the gates make throwaway repos with plain `git init`, `git config`, `git commit`,
 * `git update-ref`, `git reset --hard`. With GIT_DIR inherited, every one of those lands in the real
 * repository instead: a probe push from a worktree left the shared config with core.bare=true,
 * core.hooksPath=/dev/null and a test address as user.email, moved the branch being pushed onto junk
 * commits and rewrote origin/main, while the gate printed PASS. Every worktree shares that config, so
 * one push would switch off every hook on the machine. tools/deploy_exclusion_check.js had already met
 * this trap (cleanGitEnv); the runner had not.
 *
 * WHAT. A throwaway main repo with a linked worktree and a bare origin, holding the REAL .githooks/pre-push,
 * tools/gates.js and the two git-writing self-tests. A docs-only commit is pushed from the worktree with a
 * real `git push`, so git runs the hook with its own GIT_DIR, the hook runs gates.js, and gates.js runs
 * the self-tests. The shared repository is snapshotted before and after: config bytes, core.bare,
 * core.hooksPath, user.email, every ref, both HEADs, both indexes' contents, the bare origin's refs.
 * They must be byte-identical. Every other gate fails fast here (its file is not copied), which is fine:
 * the push is refused and nothing is meant to land; the question is only what the push did on the way.
 *
 * Four scenarios, so a green here cannot be an absence that proves nothing:
 *   A. the real files: identical, AND change-test and prepush-tier really ran (ok) inside the push.
 *   B. the real gates.js with a LEAKY gate planted (it writes user.email through whatever GIT_DIR it is
 *      handed): identical. gates.js alone keeps a careless gate out of the shared repo.
 *   C. B with gates.js's scrub cut out: the snapshot MUST differ. This proves git really exports GIT_DIR
 *      to a worktree hook here and that the matcher sees the damage.
 *   D. gates.js's scrub cut out, the real self-tests: identical. Each self-test scrubs its own git.
 * Nothing outside a temp dir is touched, and this file strips GIT_* from its own environment first, so
 * running it from inside a hook cannot reach the repository it lives in.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

for (const k of Object.keys(process.env)) if (/^GIT_/.test(k)) delete process.env[k];
/* CUBBY_PUSH_LOCK: the hook's machine push lock in a temp dir of its own, never the real one, which a real push
   holds while this runs inside it. */
const ENV = Object.assign({}, process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
  CUBBY_PUSH_LOCK: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-wt-lock-')), 'push.lock') });

const ROOT = path.join(__dirname, '..');
const SRC = path.resolve(process.env.PREPUSH_WT_FROM || ROOT);
const FILES = ['.githooks/pre-push', 'tools/gates.js', 'tools/gate_downloads.js', 'tools/serve.js',
  'tools/change_test_check.js', 'test/prepush-tier.test.js'];
const SCRUB = 'for (const k of GIT_REPO_ENV) delete e[k];';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 1600).replace(/\n/g, '\n         ') : '')); } };
const git = (cwd, args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, args) => { try { return git(cwd, args); } catch (e) { return 'ERR ' + String(e.stderr || e.message).trim().split('\n')[0]; } };
const readOr = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return 'MISSING'; } };

/* A gate that does what the old self-tests did: git config in a temp dir, with whatever env it was given.
   With GIT_DIR inherited that writes the SHARED config; without it, git finds no repo and nothing happens.
   It answers the hook's own --stdin questions honestly (pass, tree tier), and leaks only as a gate. */
const LEAKY = "const a = process.argv.slice(2);\n" +
  "if (a.includes('--tier')) { console.log('tree'); process.exit(0); }\n" +
  "if (a.includes('--stdin')) { require('fs').readFileSync(0); console.log('CHANGE-TEST: PASS'); process.exit(0); }\n" +
  "const os = require('os'), cp = require('child_process');\n" +
  "const r = cp.spawnSync('git', ['config', 'user.email', 'leak@example.test'], { cwd: os.tmpdir(), encoding: 'utf8' });\n" +
  "console.log('leaky gate: git config exited ' + r.status + (r.status ? ' (no repo reachable, nothing written)' : ' (it WROTE a repo config)'));\n" +
  "process.exit(1);   // so gates.js prints this gate's whole output into the push log\n";

function snapshot(M, WT, BARE) {
  return {
    'main .git/config': readOr(path.join(M, '.git', 'config')),
    'core.bare': tryGit(M, ['config', '--get', 'core.bare']),
    'core.hooksPath': tryGit(M, ['config', '--get', 'core.hooksPath']),
    'user.email': tryGit(M, ['config', '--get', 'user.email']),
    'refs': tryGit(M, ['for-each-ref', '--format=%(refname) %(objectname)']),
    'main HEAD': readOr(path.join(M, '.git', 'HEAD')),
    'worktree HEAD': readOr(path.join(M, '.git', 'worktrees', 'wt', 'HEAD')),
    'main is a work tree': tryGit(M, ['rev-parse', '--is-inside-work-tree']),
    'main index': tryGit(M, ['ls-files', '-s']),
    'worktree index': tryGit(WT, ['ls-files', '-s']),
    'main status': tryGit(M, ['status', '--porcelain']),
    'origin refs': tryGit(BARE, ['for-each-ref', '--format=%(refname) %(objectname)']),
  };
}
function diff(a, b) {
  return Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => k + ':\n  before ' + JSON.stringify(a[k]).slice(0, 300) + '\n  after  ' + JSON.stringify(b[k]).slice(0, 300)).join('\n');
}

/* One throwaway: main repo, linked worktree on feature-wt, bare origin, then a real push from the worktree. */
function scenario(label, files) {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-prepush-wt-'));
  const M = path.join(T, 'main'), WT = path.join(T, 'wt'), BARE = path.join(T, 'origin.git');
  fs.mkdirSync(M);
  git(M, ['init', '-q', '-b', 'main']);
  git(M, ['config', 'user.email', 'founder@example.test']); git(M, ['config', 'user.name', 'founder']);
  git(M, ['config', 'commit.gpgsign', 'false']); git(M, ['config', 'core.hooksPath', '.githooks']);
  for (const rel of Object.keys(files)) {
    fs.mkdirSync(path.dirname(path.join(M, rel)), { recursive: true });
    fs.writeFileSync(path.join(M, rel), files[rel]);
  }
  fs.chmodSync(path.join(M, '.githooks', 'pre-push'), 0o755);
  fs.writeFileSync(path.join(M, 'README.md'), 'throwaway\n');
  fs.writeFileSync(path.join(M, '.gitignore'), 'tools/node_modules\ntest/node_modules\n');
  git(M, ['add', '-A']); git(M, ['commit', '-q', '-m', 'root']);
  git(T, ['init', '-q', '--bare', BARE]);
  git(M, ['remote', 'add', 'origin', BARE]);
  git(M, ['push', '-q', '--no-verify', 'origin', 'main']);
  git(M, ['fetch', '-q', 'origin']);
  git(M, ['worktree', 'add', '-q', '-b', 'feature-wt', WT, 'main']);
  fs.mkdirSync(path.join(WT, 'tools', 'node_modules'), { recursive: true }); fs.mkdirSync(path.join(WT, 'test', 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(WT, 'docs')); fs.writeFileSync(path.join(WT, 'docs', 'notes.md'), 'words\n');
  git(WT, ['add', 'docs/notes.md']); git(WT, ['commit', '-q', '--no-verify', '-m', 'docs only']);

  const before = snapshot(M, WT, BARE);
  const push = spawnSync('git', ['push', 'origin', 'feature-wt'], { cwd: WT, env: ENV, encoding: 'utf8', timeout: 300000 });
  const out = (push.stdout || '') + (push.stderr || '');
  const after = snapshot(M, WT, BARE);
  return { label, before, after, out, same: diff(before, after) === '', diff: diff(before, after),
    ranHook: /change needs test:|CHANGE-TEST: PASS/.test(out) && /Running gates before push/.test(out) };
}

const src = {};
for (const rel of FILES) {
  try { src[rel] = fs.readFileSync(path.join(SRC, rel), 'utf8'); }
  catch (e) { ok('the source tree has ' + rel, false, SRC); }
}
console.log('\npre-push from a linked worktree: the shared repository is left byte-identical (' + SRC + ')\n');
if (fail) { console.log('\n' + pass + ' passed, ' + fail + ' failed\nPREPUSH-WORKTREE: FAIL'); process.exit(1); }

const noScrub = src['tools/gates.js'].includes(SCRUB) ? src['tools/gates.js'].replace(SCRUB, '') : null;
const tail = (s) => s.split('\n').filter((l) => /^\s{2}\S/.test(l) && /(change-test|prepush-tier)\s/.test(l)).join('\n');

/* A. The real files. */
const A = scenario('A', src);
ok('A. git ran the real hook on the worktree push, and the hook ran gates.js', A.ranHook, A.out.slice(-1200));
ok('A. inside it, the change-test self-test ran and passed', /\n\s*change-test\s+ok/.test(A.out), tail(A.out) || A.out.slice(-1200));
ok('A. and so did prepush-tier', /\n\s*prepush-tier\s+ok/.test(A.out), tail(A.out) || A.out.slice(-1200));
ok('A. the shared repository is byte-identical afterwards (config, core.bare, hooksPath, user.email, refs, HEADs, indexes, origin)', A.same, A.diff);

/* B. The real gates.js, with a gate that would leak if it could. */
/* B and C leave prepush-tier out (it fails fast as missing), so the only git writer is the planted one. */
const leakyFiles = (gates) => { const f = Object.assign({}, src, { 'tools/gates.js': gates, 'tools/change_test_check.js': LEAKY }); delete f['test/prepush-tier.test.js']; return f; };
const B = scenario('B', leakyFiles(src['tools/gates.js']));
ok('B. a leaky gate ran inside the push', /leaky gate: git config exited/.test(B.out), B.out.slice(-1200));
ok('B. and tools/gates.js alone kept it out of the shared repository (identical)', B.same, B.diff + '\n' + (B.out.match(/leaky gate:[^\n]*/) || [''])[0]);

/* C. The same, with gates.js's scrub cut out: the damage must show, or none of these lines mean anything. */
ok('C. the plant applies (gates.js has the scrub line to cut)', noScrub !== null, 'no line "' + SCRUB + '" in ' + path.join(SRC, 'tools/gates.js'));
if (noScrub !== null) {
  const C = scenario('C', leakyFiles(noScrub));
  ok('C. without the scrub the leaky gate DOES rewrite the shared repo (git exports GIT_DIR to a worktree hook)',
    !C.same && /leak@example\.test/.test(C.after['user.email']), C.diff || C.out.slice(-1200));
  /* D. Defence in depth: a runner that leaks, and the real self-tests still write nothing shared. */
  const D = scenario('D', Object.assign({}, src, { 'tools/gates.js': noScrub }));
  ok('D. with a runner that leaks GIT_DIR, the real change-test and prepush-tier still ran',
    /\n\s*change-test\s+ok/.test(D.out) && /\n\s*prepush-tier\s+ok/.test(D.out), tail(D.out) || D.out.slice(-1200));
  ok('D. and they scrub their own git: the shared repository is identical', D.same, D.diff);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log('PREPUSH-WORKTREE: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
