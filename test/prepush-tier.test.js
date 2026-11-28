/* Does .githooks/pre-push refuse main up front, run no gates on a branch push, and refuse a code change
 * with no test?
 *
 *   node test/prepush-tier.test.js
 *
 * WHY. A hook is a shell script nobody watches run. Since 28 Nov 2026 it makes three decisions from git's
 * stdin: a push to main is refused before anything else runs (GitHub refuses it anyway: main needs passing
 * status checks, so the old hook spent 104-140 min of suite on a push that could not land); a branch push
 * runs NO gates (CI runs them on the PR); and a push that changes product code without a test is stopped
 * (tools/change_test_check.js). Each is only worth something if it is made from what git really hands the
 * hook, so this builds a throwaway repo in os.tmpdir(), copies in the REAL hook and the REAL
 * change_test_check.js, stands a stub in for tools/gates.js that records any call, and drives the hook two
 * ways: with git's stdin lines written by hand, and through a real `git push` to a bare repo next to it.
 * Nothing outside the temp dir is touched; nothing is pushed anywhere real.
 *
 *   PREPUSH_HOOK=/path/to/old/pre-push node test/prepush-tier.test.js   grade another hook (the red run:
 *   the hook of 4e50b5e6, and the push-lock one after it, each fail 16 of these 23 lines; see docs/TESTING.md)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

/* Before any git: inside a hook (this runs as a pre-push gate) git exports GIT_DIR, and from a linked worktree
   it names the SHARED repository. Inherited, the `git init`, `git config`, `reset --hard`, `checkout -b` and
   `init --bare` below rewrote that repository instead of the temp one (core.bare=true, a test user.email,
   moved branch heads). tools/gates.js scrubs it for every gate; this scrubs it again so the test is safe
   however it is started, and every hook and push it spawns inherits the scrubbed env.
   test/prepush-worktree.test.js runs this inside a real push from a linked worktree. */
for (const k of Object.keys(process.env)) if (/^GIT_/.test(k)) delete process.env[k];

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 600) : '')); } };

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-prepush-'));
const W = path.join(T, 'work'), BARE = path.join(T, 'origin.git');
const git = (args, cwd) => execFileSync('git', args, { cwd: cwd || W, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(W, p)), { recursive: true }); fs.writeFileSync(path.join(W, p), s); };
const CALLS = path.join(T, 'gates-calls.txt');
/* The hook's machine push lock, here and in every run below, never the real one (a real push holds that while
   this runs inside it, and would be waited for forever). */
process.env.CUBBY_PUSH_LOCK = path.join(T, 'push.flock');
/* java, hermetic: every hook run sees a fake java that runs (or, where a line says so, one that cannot), never
   this machine's. JAVA_HOME is dropped so the hook asks the java on PATH unless a line sets one. */
const fakeJava = (dir, code) => { fs.mkdirSync(path.join(dir, 'bin'), { recursive: true }); const f = path.join(dir, 'bin', 'java');
  fs.writeFileSync(f, '#!/bin/sh\n' + (code ? 'echo "The operation couldn\'t be completed. Unable to locate a Java Runtime." >&2\n' : 'echo "openjdk version 99" >&2\n') + 'exit ' + code + '\n'); fs.chmodSync(f, 0o755); return dir; };
const JAVA_OK = fakeJava(path.join(T, 'java-ok'), 0), JAVA_STUB = fakeJava(path.join(T, 'java-stub'), 1);
delete process.env.JAVA_HOME;
const PATH0 = process.env.PATH;
process.env.PATH = path.join(JAVA_OK, 'bin') + path.delimiter + PATH0;
const ZERO = '0000000000000000000000000000000000000000';

console.log('\npre-push: main refused up front, no gates on a branch push, change-needs-test, from git\'s own stdin\n');
fs.mkdirSync(W);
git(['init', '-q', '-b', 'main']);
git(['config', 'user.email', 'prepush@example.test']); git(['config', 'user.name', 'prepush test']); git(['config', 'commit.gpgsign', 'false']);
w('.githooks/pre-push', fs.readFileSync(process.env.PREPUSH_HOOK || path.join(ROOT, '.githooks', 'pre-push'), 'utf8'));
fs.chmodSync(path.join(W, '.githooks', 'pre-push'), 0o755);
w('tools/change_test_check.js', fs.readFileSync(path.join(ROOT, 'tools', 'change_test_check.js'), 'utf8'));
/* The stub: records its arguments, and fails when the test asks it to. */
w('tools/gates.js', "require('fs').appendFileSync(" + JSON.stringify(CALLS) + ", JSON.stringify(process.argv.slice(2)) + '\\n');\n" +
  "process.exit(process.env.STUB_GATES_FAIL ? 1 : 0);\n");
w('README.md', 'x\n'); w('app/index.html', '<p>1</p>\n'); w('firestore.rules', 'r1\n'); w('test/rules-test.js', 't1\n');
w('.gitignore', 'tools/node_modules\ntest/node_modules\n');
git(['add', '-A']); git(['commit', '-q', '-m', 'root']);
fs.mkdirSync(path.join(W, 'tools', 'node_modules')); fs.mkdirSync(path.join(W, 'test', 'node_modules'));
const root = git(['rev-parse', 'HEAD']);
git(['init', '-q', '--bare', BARE]);
git(['remote', 'add', 'origin', BARE]);
git(['push', '-q', '--no-verify', 'origin', 'main']);
git(['fetch', '-q', 'origin']);

const commit = (files, msg) => { Object.keys(files).forEach((p) => w(p, files[p])); git(['add', '-A']); git(['commit', '-q', '-m', msg]); return git(['rev-parse', 'HEAD']); };
const calls = () => { try { return fs.readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } };
const hook = (stdin, env) => {
  try { fs.unlinkSync(CALLS); } catch (e) {}
  const r = spawnSync('sh', [path.join(W, '.githooks', 'pre-push'), 'origin', BARE], { cwd: W, input: stdin, encoding: 'utf8',
    env: Object.assign({}, process.env, env || {}) });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), calls: calls() };
};
const line = (head, remote) => 'refs/heads/main ' + head + ' refs/heads/main ' + (remote || root) + '\n';

/* 1. main is refused UP FRONT: before change_test_check, before the lock, before any gate. GitHub refuses a
   direct push to main (required checks, strict), so the old hook ran 104-140 min of suite and was refused after. */
const noLock = () => !fs.existsSync(process.env.CUBBY_PUSH_LOCK);
const MAIN_MSG = /This push targets main[\s\S]*open a PR instead/;
const codeOnly = commit({ 'app/index.html': '<p>2</p>\n' }, 'app change, no test');
let r = hook(line(codeOnly));
ok('1. a push to main is refused', r.code === 1 && MAIN_MSG.test(r.out), r.out);
ok('1. before any gate runs (no gates.js call at all)', r.calls.length === 0, JSON.stringify(r.calls));
ok('1. and before change_test_check is asked (a code-only commit gets the main refusal, not the test one)',
  !/product code changed and no test/.test(r.out), r.out);
ok('1. and it names the way in: a PR, and the train that opens one', /gh pr create --base main/.test(r.out) && /tools\/train\.js --go/.test(r.out), r.out);
r = hook('refs/heads/feature ' + codeOnly + ' refs/heads/main ' + root + '\n');
ok('1. a local branch pushed onto remote main is refused the same way', r.code === 1 && MAIN_MSG.test(r.out) && r.calls.length === 0, r.out);
r = hook('refs/heads/a ' + codeOnly + ' refs/heads/a ' + ZERO + '\nrefs/heads/main ' + codeOnly + ' refs/heads/main ' + root + '\n');
ok('1. one main ref among branch refs refuses the whole push', r.code === 1 && MAIN_MSG.test(r.out) && r.calls.length === 0, r.out);
r = hook('(delete) ' + ZERO + ' refs/heads/main ' + root + '\n');
ok('1. and so does deleting main', r.code === 1 && MAIN_MSG.test(r.out), r.out);
ok('1. a refused push never took the machine push lock', noLock(), process.env.CUBBY_PUSH_LOCK);
/* Companion: the matcher is the whole ref, not a prefix. */
git(['reset', '-q', '--hard', root]);
const docs = commit({ 'docs/notes.md': 'words\n' }, 'docs');
r = hook('refs/heads/mainline ' + docs + ' refs/heads/mainline ' + ZERO + '\n');
ok('1. companion: a branch called mainline is a branch push, not main', r.code === 0 && !MAIN_MSG.test(r.out), r.out);

/* 2. A branch push runs NO gates, whatever it touches. CI runs them on the PR. */
const BRANCH = (head, name) => 'refs/heads/' + (name || 'feature') + ' ' + head + ' refs/heads/' + (name || 'feature') + ' ' + ZERO + '\n';
r = hook(BRANCH(docs));
ok('2. a docs-only branch push passes and runs no gate', r.code === 0 && r.calls.length === 0, JSON.stringify(r.calls) + '\n' + r.out);
ok('2. and says so (CI runs them on the PR)', /no gates run here/.test(r.out), r.out);
git(['checkout', '-q', '-b', 'feature', root]);
const feat = commit({ 'worker.js': 'w\n', 'test/worker-routes.test.js': 'x\n' }, 'worker + test');
r = hook(BRANCH(feat));
ok('2. a branch push touching worker.js runs no gate either (no emulator tier here; CI runs it on the PR)', r.code === 0 && r.calls.length === 0, JSON.stringify(r.calls) + '\n' + r.out);
const rules = commit({ 'firestore.rules': 'r2\n', 'test/rules-test.js': 't2\n' }, 'tighten a rule, with its test');
r = hook(BRANCH(rules), { PATH: path.join(JAVA_STUB, 'bin') + path.delimiter + PATH0 });
ok('2. nor asks for java on a rules change', r.code === 0 && r.calls.length === 0 && !/does not run/.test(r.out), r.out);
r = hook(BRANCH(rules), { STUB_GATES_FAIL: '1' });
ok('2. so a failing gate cannot stop a branch push here (the PR is where it goes red)', r.code === 0 && r.calls.length === 0, r.out);

/* 3. Product code, no test: stopped on a branch push too. */
git(['checkout', '-q', '-b', 'code-only', root]);
const code2 = commit({ 'app/index.html': '<p>4</p>\n' }, 'app change, no test');
r = hook(BRANCH(code2, 'code-only'));
ok('3. a code change with no test stops a branch push', r.code === 1 && r.calls.length === 0 && /product code changed and no test/.test(r.out), r.out);
ok('3. naming the file and the way out', /app\/index\.html/.test(r.out) && /Test-exempt: <why no test can see this>/.test(r.out), r.out);

/* 4. The same change, exempted in writing: allowed, and the reason is printed. */
git(['checkout', '-q', '-b', 'exempt', root]);
const exempt = commit({ 'app/index.html': '<p>3</p>\n' }, 'copy only\n\nTest-exempt: a word in a heading, nothing a test can see');
r = hook(BRANCH(exempt, 'exempt'));
ok('4. a Test-exempt trailer lets it through, with no gate', r.code === 0 && r.calls.length === 0, r.out);
ok('4. and prints the reason in the push output', /a word in a heading, nothing a test can see/.test(r.out), r.out);

/* 5. No node_modules needed: a branch push runs no gate, so it has nothing to load. */
fs.renameSync(path.join(W, 'tools', 'node_modules'), path.join(W, 'tools', 'node_modules-away'));
fs.renameSync(path.join(W, 'test', 'node_modules'), path.join(W, 'test', 'node_modules-away'));
r = hook(BRANCH(docs, 'docs'));
ok('5. a branch push from a tree with no tools/ or test/node_modules passes (nothing it runs needs them)', r.code === 0 && r.calls.length === 0, r.out);
fs.renameSync(path.join(W, 'tools', 'node_modules-away'), path.join(W, 'tools', 'node_modules'));
fs.renameSync(path.join(W, 'test', 'node_modules-away'), path.join(W, 'test', 'node_modules'));

/* 6. The real thing: git itself runs the hook on `git push`, with its own stdin. */
git(['config', 'core.hooksPath', '.githooks']);
git(['checkout', '-q', 'feature']);
try { fs.unlinkSync(CALLS); } catch (e) {}
const push = spawnSync('git', ['push', 'origin', 'feature'], { cwd: W, encoding: 'utf8' });
ok('6. a real `git push` of a branch runs the hook, which runs no gate, and the branch lands',
  push.status === 0 && calls().length === 0 && git(['rev-parse', 'refs/heads/feature'], BARE) === rules, (push.stdout || '') + (push.stderr || '') + JSON.stringify(calls()));
const onTop = commit({ 'app/store-firebase.js': 'changed\n' }, 'a Firestore-layer change on top, no test');
const push2 = spawnSync('git', ['push', 'origin', 'feature'], { cwd: W, encoding: 'utf8' });
ok('6. a real `git push` of a code-only change is refused by it', push2.status !== 0 && /product code changed and no test/.test(push2.stdout + push2.stderr), push2.stdout + push2.stderr);
const push3 = spawnSync('git', ['push', 'origin', 'feature:main'], { cwd: W, encoding: 'utf8' });
ok('6. and a real `git push origin feature:main` is refused up front', push3.status !== 0 && MAIN_MSG.test(push3.stdout + push3.stderr) && calls().length === 0, push3.stdout + push3.stderr);
ok('6. so the bare origin\'s main is still the root commit, and its feature the rules commit',
  git(['rev-parse', 'main'], BARE) === root && git(['rev-parse', 'refs/heads/feature'], BARE) === rules && onTop !== rules, git(['rev-parse', 'main'], BARE));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log('PREPUSH-TIER: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
