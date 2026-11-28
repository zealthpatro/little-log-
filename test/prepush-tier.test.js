/* Does .githooks/pre-push pick the right tier, and refuse a code change with no test?
 *
 *   node test/prepush-tier.test.js
 *
 * WHY. The pre-push hook is the only thing that runs the suite before a deploy, and a hook is a shell
 * script nobody watches run. It now makes two decisions from git's stdin: whether the push changes
 * product code without a test (tools/change_test_check.js), and whether it needs the Firestore emulator
 * tier. Both are only worth something if they are made from what git really hands the hook, so this
 * builds a throwaway repo in os.tmpdir(), copies in the REAL hook and the REAL change_test_check.js,
 * stands a stub in for tools/gates.js that records how it was called, and drives the hook two ways:
 * with git's stdin lines written by hand, and through a real `git push` to a bare repo next to it.
 * Nothing outside the temp dir is touched; nothing is pushed anywhere real.
 *
 *   PREPUSH_HOOK=/path/to/old/pre-push node test/prepush-tier.test.js   grade another hook (the red run:
 *   the hook before Nov 2026 fails 11 of these 15 lines)
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
process.env.CUBBY_PUSH_LOCK = path.join(T, 'push.lock');
/* java, hermetic: every hook run sees a fake java that runs (or, where a line says so, one that cannot), never
   this machine's. JAVA_HOME is dropped so the hook asks the java on PATH unless a line sets one. */
const fakeJava = (dir, code) => { fs.mkdirSync(path.join(dir, 'bin'), { recursive: true }); const f = path.join(dir, 'bin', 'java');
  fs.writeFileSync(f, '#!/bin/sh\n' + (code ? 'echo "The operation couldn\'t be completed. Unable to locate a Java Runtime." >&2\n' : 'echo "openjdk version 99" >&2\n') + 'exit ' + code + '\n'); fs.chmodSync(f, 0o755); return dir; };
const JAVA_OK = fakeJava(path.join(T, 'java-ok'), 0), JAVA_STUB = fakeJava(path.join(T, 'java-stub'), 1);
delete process.env.JAVA_HOME;
const PATH0 = process.env.PATH;
process.env.PATH = path.join(JAVA_OK, 'bin') + path.delimiter + PATH0;
const ZERO = '0000000000000000000000000000000000000000';

console.log('\npre-push: the tier and the change-needs-test refusal, from git\'s own stdin\n');
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

/* 1. Rules + their test: the emulator tier. */
const rules = commit({ 'firestore.rules': 'r2\n', 'test/rules-test.js': 't2\n' }, 'tighten a rule, with its test');
let r = hook(line(rules));
ok('a push that touches firestore.rules runs `gates.js --emulator`', r.code === 0 && r.calls.length === 1 && r.calls[0].join(' ') === '--emulator', JSON.stringify(r.calls) + '\n' + r.out);
ok('and says why', /running the emulator tier too/.test(r.out), r.out);

/* 2. Docs only: the tree tier, exactly as before. */
git(['reset', '-q', '--hard', root]);
const docs = commit({ 'docs/notes.md': 'words\n' }, 'docs');
r = hook(line(docs));
ok('a docs-only push runs plain `gates.js` (the tree tier)', r.code === 0 && r.calls.length === 1 && r.calls[0].length === 0, JSON.stringify(r.calls) + '\n' + r.out);

/* 3. Product code, no test: stopped before any gate runs. */
git(['reset', '-q', '--hard', root]);
const codeOnly = commit({ 'app/index.html': '<p>2</p>\n' }, 'app change, no test');
r = hook(line(codeOnly));
ok('a code change with no test stops the push', r.code === 1 && r.calls.length === 0, r.out);
ok('naming the file and the way out', /app\/index\.html/.test(r.out) && /Test-exempt: <why no test can see this>/.test(r.out), r.out);

/* 4. The same change, exempted in writing: allowed, and the reason is printed. */
git(['reset', '-q', '--hard', root]);
const exempt = commit({ 'app/index.html': '<p>3</p>\n' }, 'copy only\n\nTest-exempt: a word in a heading, nothing a test can see');
r = hook(line(exempt));
ok('a Test-exempt trailer lets it through, on the tree tier', r.code === 0 && r.calls.length === 1 && r.calls[0].length === 0, r.out);
ok('and prints the reason in the push output', /a word in a heading, nothing a test can see/.test(r.out), r.out);

/* 5. A new branch: remote sha all zeros, judged from the merge-base with origin/main. */
git(['checkout', '-q', '-b', 'feature', root]);
const feat = commit({ 'worker.js': 'w\n', 'test/worker-routes.test.js': 'x\n' }, 'worker + test');
r = hook('refs/heads/feature ' + feat + ' refs/heads/main ' + root + '\n');
ok('a new branch touching worker.js runs the emulator tier', r.code === 0 && r.calls.length === 1 && r.calls[0].join(' ') === '--emulator', r.out);

/* 6. A gate fails: the push stops. */
r = hook('refs/heads/feature ' + feat + ' refs/heads/feature ' + ZERO + '\n');
ok('a branch push (not main) runs only the Chrome-free gates, even when it touches worker.js', r.code === 0 && r.calls.length === 1 && r.calls[0].join(' ') === '--no-browser', JSON.stringify(r.calls) + '\n' + r.out);
r = hook('refs/heads/feature ' + feat + ' refs/heads/feature ' + ZERO + '\n', { STUB_GATES_FAIL: '1' });
ok('and a failing gate still stops a branch push', r.code === 1 && /Push stopped: a gate failed/.test(r.out), r.out);
r = hook(line(docs), { STUB_GATES_FAIL: '1' });
ok('a failing gate still stops the push', r.code === 1 && /Push stopped: a gate failed/.test(r.out), r.out);

/* 6b. java must RUN, not merely exist. On a Mac /usr/bin/java is Apple's stub, there with or without a JDK,
   so the old `command -v java` guard never refused anything there. */
const stubPath = path.join(JAVA_STUB, 'bin') + path.delimiter + PATH0;
r = hook('refs/heads/feature ' + feat + ' refs/heads/main ' + root + '\n', { PATH: stubPath });
ok('an emulator-tier push where java is only a stub that cannot run is refused, before any gate', r.code === 1 && r.calls.length === 0 && /does not run/.test(r.out), r.out);
r = hook('refs/heads/feature ' + feat + ' refs/heads/main ' + root + '\n', { JAVA_HOME: JAVA_STUB });
ok('and so is one whose JAVA_HOME holds a java that cannot run (the java the suites would use)', r.code === 1 && r.calls.length === 0 && /does not run/.test(r.out), r.out);
r = hook(line(docs), { PATH: stubPath });
ok('a tree-tier push never asks for java', r.code === 0 && r.calls.length === 1 && r.calls[0].length === 0, r.out);

/* 7. No test/node_modules: refused UP FRONT, on either tier, before a single gate runs. The first
   security push of Nov 2026 died after 56 minutes on exactly this, when the suites that need it were
   finally reached. A docs-only push is refused too, because several tree gates load firebase. */
fs.renameSync(path.join(W, 'test', 'node_modules'), path.join(W, 'test', 'node_modules-away'));
r = hook('refs/heads/feature ' + feat + ' refs/heads/main ' + root + '\n');
ok('an emulator-tier push without test/node_modules is refused, not waved through', r.code === 1 && r.calls.length === 0 && /test\/node_modules is missing/.test(r.out), r.out);
r = hook(line(docs));
ok('and so is a tree-tier push, before any gate runs (no 56-minute surprise)', r.code === 1 && r.calls.length === 0 && /test\/node_modules is missing/.test(r.out), r.out);
fs.renameSync(path.join(W, 'test', 'node_modules-away'), path.join(W, 'test', 'node_modules'));
fs.rmdirSync(path.join(W, 'tools', 'node_modules'));
r = hook(line(docs));
ok('a push without tools/node_modules is refused as before', r.code === 1 && r.calls.length === 0 && /tools\/node_modules is missing/.test(r.out), r.out);
fs.mkdirSync(path.join(W, 'tools', 'node_modules'));

/* 8. The real thing: git itself runs the hook on `git push`, with its own stdin. */
git(['config', 'core.hooksPath', '.githooks']);
git(['checkout', '-q', 'main']); git(['reset', '-q', '--hard', rules]);
try { fs.unlinkSync(CALLS); } catch (e) {}
const push = spawnSync('git', ['push', 'origin', 'main'], { cwd: W, encoding: 'utf8' });
ok('a real `git push` of the rules change runs the hook, which asks for --emulator', push.status === 0 && calls().length === 1 && calls()[0].join(' ') === '--emulator', (push.stdout || '') + (push.stderr || '') + JSON.stringify(calls()));
const onTop = commit({ 'app/store-firebase.js': 'changed\n' }, 'a Firestore-layer change on top, no test');
const push2 = spawnSync('git', ['push', 'origin', 'main'], { cwd: W, encoding: 'utf8' });
ok('and a real `git push` of a code-only change is refused by it', push2.status !== 0 && /product code changed and no test/.test(push2.stdout + push2.stderr), push2.stdout + push2.stderr);
ok('so the bare origin still holds the rules commit', git(['rev-parse', 'main'], BARE) === rules, git(['rev-parse', 'main'], BARE));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log('PREPUSH-TIER: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
