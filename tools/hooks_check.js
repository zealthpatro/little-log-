/* Are the git hooks the ONE path git will actually use, and do they run what they claim?
 *
 *   node tools/hooks_check.js
 *   node tools/hooks_check.js --self-test    prove this gate can go red
 *
 * WHY THIS EXISTS. tools/install_hooks.sh wrote pre-push into .git/hooks. Later core.hooksPath was
 * pointed at .githooks so the pre-commit hook could be tracked and travel with a clone. Git then
 * ignores .git/hooks ENTIRELY. The pre-push hook stayed there, executable, looking installed, and
 * had not run before a single push since. On this repo a push to main IS the deploy, so the full
 * gate suite had never once blocked a bad deploy automatically, and nothing reported that, because
 * a hook that is never invoked cannot report anything.
 *
 * Same shape as the other two found the same week: an Android release that builds clean and cannot
 * sign anybody in, and a canary that runs every fifteen minutes and mails an address nobody set. A
 * safeguard that looks present and does nothing is worse than an absent one, because it is budgeted
 * for. So the assertion here is never "a file exists somewhere" but "the exact path git resolves is
 * a real executable, and its contents do what the push needs" (since 28 Nov 2026: refuse main up front,
 * ask change-needs-test, take the push lock, run no gates; the PR's CI is the gating run).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + detail : '')); }
};
const git = (args) => execSync('git ' + args, { encoding: 'utf8' }).trim();

const SELF_TEST = process.argv.includes('--self-test');

console.log('\ngit hooks: the path git actually uses\n');

/* The only question that matters. Not "is there a hook file", which was true the whole time it was
   broken, but "what will git run", which is one path and one path only. */
const resolved = {};
for (const h of ['pre-commit', 'pre-push']) {
  const p = git('rev-parse --git-path hooks/' + h);
  resolved[h] = p;
  const exists = fs.existsSync(p);
  ok(h + ' resolves to a file that exists', exists, p);
  if (exists) {
    let mode = 0;
    try { mode = fs.statSync(p).mode & 0o111; } catch (e) {}
    ok('and ' + h + ' is executable here, so git can run it', mode !== 0, p + ' mode ' + mode.toString(8));
    /* The working tree is the tree you are standing in. The COMMITTED object is what every clone gets.
       On 2026-09-07 .githooks/pre-push was +x here and 100644 on origin/main, so this Mac was green
       while every fresh checkout had a hook git could not execute. Ask git, not stat. */
    /* In a git worktree core.hooksPath is an absolute path into the MAIN checkout, so git runs the main
       checkout's hook and p lies outside this tree. Relative to this worktree it became
       "../../../.githooks/pre-commit", ls-tree found nothing, and this failed in every worktree, which
       also blocked every push from one, because pre-push runs this suite. The committed-mode question is
       about the repository's file, so a path outside this tree is re-based on the main repository root.
       A hook outside ANY repository still resolves to "../" there and still fails, as it should. */
    let rel = path.relative(git('rev-parse --show-toplevel'), p);
    if (rel.startsWith('..')) {
      const mainRoot = path.dirname(git('rev-parse --path-format=absolute --git-common-dir'));
      rel = path.relative(mainRoot, p);
    }
    rel = rel.split(path.sep).join('/');
    let committed = '';
    try { committed = execSync('git ls-tree HEAD -- ' + JSON.stringify(rel), { encoding: 'utf8' }).split(/\s+/)[0] || ''; } catch (e) {}
    ok('and ' + h + ' is committed as 100755, so a CLONE can run it too', committed === '100755',
      rel + ' committed as ' + (committed || 'untracked') + ' (fix: git update-index --chmod=+x ' + rel + ')');
  }
}

/* What the pre-push must do (28 Nov 2026, docs/TESTING.md). main takes merges only through a PR whose CI is green,
   so the hook refuses a main ref UP FRONT (before the lock, the check or anything else: the old hook ran the full
   suite for 104-140 min on a push GitHub then refused), stops a product change that came with no test
   (tools/change_test_check.js) under the machine push lock (a kernel flock, never a mkdir with a pid in it: a
   skeptic broke that one three ways on 28 Nov), and runs NO gates on a branch push: CI runs them on the PR, and a
   red PR cannot merge. Behaviour is proven by test/prepush-tier.test.js and test/push-lock.test.js
   in throwaway repos; these lines only stop the wiring being edited out. */
const pp = resolved['pre-push'];
const body = fs.existsSync(pp) ? fs.readFileSync(pp, 'utf8') : '';
const codeOf = (b) => b.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');   // comments may name the old way
const hookAsks = (b) => {
  const code = codeOf(b);
  const mainAt = code.search(/\$3 == "refs\/heads\/main"/), checkAt = code.indexOf('change_test_check.js'), lockAt = code.search(/flock\(\$fh, LOCK_EX/);
  return {
    mainFirst: mainAt >= 0 && /refs\/heads\/main"[^\n]*\n(?:[^\n]*\n){0,6}?\s*exit 1/.test(code.slice(mainAt)) &&
      (checkAt < 0 || mainAt < checkAt) && (lockAt < 0 || mainAt < lockAt),
    changeTest: /tools\/change_test_check\.js"? --stdin/.test(code) && /change_test_check[\s\S]*?exit 1/.test(code),
    /* The kernel flock (released by the kernel however its holder ends), and the check runs inside it. A mkdir
       lock is refused outright: six waiters behind a dead mkdir holder all took it over (test/push-lock.test.js). */
    pushLock: lockAt >= 0 && /with_push_lock node "\$ROOT\/tools\/change_test_check\.js"/.test(code) && !/mkdir "\$PUSH_LOCK"/.test(code),
    noGates: !/tools\/gates\.js/.test(code),
  };
};
const asks = hookAsks(body);
ok('pre-push refuses a push to main up front, before the lock, the check or any gate', asks.mainFirst,
  'a push to main would run here and then be refused by GitHub (main needs passing status checks)');
ok('pre-push stops a product change that came with no test (change_test_check.js --stdin)', asks.changeTest,
  'the hook never asks tools/change_test_check.js, or does not stop the push when it says no');
ok('and runs that check under the machine push lock, a kernel flock', asks.pushLock, 'no flock($fh, LOCK_EX) around change_test_check.js (with_push_lock), or a mkdir "$PUSH_LOCK" lock');
ok('and runs no gates on a branch push (CI runs them on the PR)', asks.noGates,
  'the hook still calls tools/gates.js: the 23-minute run CI repeats on the PR minutes later');

/* Paired, so the lines above cannot pass on a technicality: the resolved path must be the TRACKED
   directory. If it points back into .git/hooks, a fresh clone or a new worktree gets nothing. */
const tracked = /\.githooks\//.test(pp);
ok('the hooks git uses are the tracked ones, so a clone gets them', tracked, pp);

/* The dead copies are not a failure, but they are the exact confusion that caused this, so say so
   out loud rather than letting the next person read them as protection. */
const root = git('rev-parse --show-toplevel');
const strays = ['pre-commit', 'pre-push'].filter((h) => fs.existsSync(root + '/.git/hooks/' + h));
if (strays.length) {
  console.log('  note  .git/hooks/' + strays.join(', .git/hooks/') +
    ' still exist and git will never run them (core.hooksPath wins)');
}

/* THE CACHE-BUMP GUARD, AND WHY IT IS DERIVED RATHER THAN WRITTEN DOWN.
   pre-commit stops a commit that changes a precached asset without bumping app/sw.js's CACHE,
   because the service worker is cache-first for everything but HTML and JS: a missed bump ships to
   new installs and reaches nobody who already has Cubby. The list of what counts used to be a
   hand-written pattern, `^app/.*\.(js|html|css)$`, and it had silently fallen behind ASSETS —
   app/manifest.webmanifest, app/spot-art/offline_balloon.webp and five PNGs under /icons are all
   precached and none of them matched. Adding `shortcuts` to the manifest on 2026-09-26 was the
   first change to land in that gap. It is now derived from ASSETS by tools/sw_cache_guard.js, so
   growing the precache cannot leave the guard behind; these two assertions pin that wiring. */
const pc = resolved['pre-commit'];
const pcBody = fs.existsSync(pc) ? fs.readFileSync(pc, 'utf8') : '';
ok('pre-commit derives the cacheable set from the service worker, not from a pattern',
  /sw_cache_guard\.js/.test(pcBody), 'the hook still hardcodes which files count as cacheable');
ok('and tools/sw_cache_guard.js is there to be called',
  fs.existsSync(root + '/tools/sw_cache_guard.js'), root + '/tools/sw_cache_guard.js');

/* This gate can only ever report an ABSENCE of breakage, so on its own a green line is
   indistinguishable from a check that stopped checking. Stage the real failure and make the same
   predicate catch it. */
if (SELF_TEST) {
  console.log('\nself-test: the same assertions against hooks that do the wrong thing');
  const fake = '#!/bin/sh\necho "I look like a hook"\nexit 0\n';
  const f = hookAsks(fake);
  ok('a hook that does nothing is caught (no main refusal, no change-test, no lock)', !f.mainFirst && !f.changeTest && !f.pushLock);
  /* The hook of 4e50b5e6: change-test, then the Chrome-free gates on a branch push, the full suite on main. */
  const oldHook = '#!/bin/sh\nROOT=$(git rev-parse --show-toplevel)\nRANGES=$(cat)\n' +
    'if ! printf \'%s\\n\' "$RANGES" | node "$ROOT/tools/change_test_check.js" --stdin; then\n  exit 1\nfi\n' +
    'if ! printf \'%s\\n\' "$RANGES" | awk \'$3 == "refs/heads/main" { found = 1 } END { exit !found }\'; then\n' +
    '  if ! node "$ROOT/tools/gates.js" --no-browser; then\n    exit 1\n  fi\n  exit 0\nfi\nnode "$ROOT/tools/gates.js" || exit 1\n';
  const o = hookAsks(oldHook);
  ok('the hook of 4e50b5e6 is caught: it runs gates on a branch push', o.changeTest && !o.noGates);
  ok('and its main test only picks a tier (no exit 1 after it), after change-test: not a refusal up front', !o.mainFirst);
  const flockFn = 'with_push_lock() {\n  perl -MFcntl=:flock -e \'\n    open(my $fh, ">>", shift) or exit 1;\n    flock($fh, LOCK_EX) or exit 1;\n    exit(system(@ARGV) >> 8);\n  \' "$PUSH_LOCK" "$@"\n}\n';
  const lateMain = '#!/bin/sh\nRANGES=$(cat)\n' + flockFn +
    'printf \'%s\\n\' "$RANGES" | with_push_lock node "$ROOT/tools/change_test_check.js" --stdin || exit 1\n' +
    'if printf \'%s\\n\' "$RANGES" | awk \'$3 == "refs/heads/main" { found = 1 } END { exit !found }\'; then\n  exit 1\nfi\n';
  ok('a hook that refuses main only after the lock and the check is caught', !hookAsks(lateMain).mainFirst && hookAsks(lateMain).pushLock);
  /* The first push lock of 28 Nov: a mkdir with a pid in it, released by a trap. */
  const mkdirHook = '#!/bin/sh\nRANGES=$(cat)\n' +
    'if printf \'%s\\n\' "$RANGES" | awk \'$3 == "refs/heads/main" { found = 1 } END { exit !found }\'; then\n  exit 1\nfi\n' +
    'until mkdir "$PUSH_LOCK" 2>/dev/null; do sleep 15; done\ntrap \'rm -f x; rmdir "$PUSH_LOCK"\' EXIT\n' +
    'printf \'%s\\n\' "$RANGES" | node "$ROOT/tools/change_test_check.js" --stdin || exit 1\n';
  ok('a mkdir push lock (the design a skeptic broke) is caught', hookAsks(mkdirHook).mainFirst && hookAsks(mkdirHook).changeTest && !hookAsks(mkdirHook).pushLock);
  ok('and so is a flock that the check does not run inside', !hookAsks('#!/bin/sh\nRANGES=$(cat)\n' + flockFn + 'node "$ROOT/tools/change_test_check.js" --stdin || exit 1\n').pushLock);
  ok('and its companion, the real hook, passes all four (the matchers can say yes)', (() => { const r = hookAsks(body); return r.mainFirst && r.changeTest && r.pushLock && r.noGates; })());
  const commented = '#!/bin/sh\n# it used to run node "$ROOT/tools/gates.js"\n';
  ok('a gates.js named only in a comment does not count as running gates', hookAsks(commented).noGates);
  const deadPath = root + '/.git/hooks/pre-push';
  ok('an untracked hook path is caught', /\.githooks\//.test(deadPath) === false, deadPath);
  const m644 = execSync('git ls-tree HEAD -- CLAUDE.md', { encoding: 'utf8' }).split(/\s+/)[0];
  ok('a committed 100644 mode is caught (CLAUDE.md stands in)', m644 !== '100755', m644);

  /* The cache guard, both ways, against the real ASSETS list. A guard that answered "yes" to
     everything would pass the line above just as well as one that answers "no" to everything. */
  const askGuard = (paths) => execSync('node ' + JSON.stringify(root + '/tools/sw_cache_guard.js'),
    { input: paths.join('\n'), encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const flagged = askGuard(['app/manifest.webmanifest', 'app/index.html', 'icons/icon-192.png']);
  const ignored = askGuard(['README.md', 'icons/screenshots/01-two-names.png', 'tools/gates.js', 'app/sw.js']);
  ok('the cache guard flags a precached file the old pattern missed',
    flagged.indexOf('app/manifest.webmanifest') >= 0 && flagged.indexOf('icons/icon-192.png') >= 0, flagged);
  ok('and it stays quiet on files the service worker does not precache',
    ignored.length === 0, ignored);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log('HOOKS: ' + (fail ? 'FAIL' : 'PASS') + '\n');
process.exit(fail ? 1 : 0);
