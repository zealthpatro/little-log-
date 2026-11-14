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
 * a real executable, and its contents run the suite".
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

/* A pre-push that exists but does not run the gates is the same failure wearing a different hat. */
const pp = resolved['pre-push'];
const body = fs.existsSync(pp) ? fs.readFileSync(pp, 'utf8') : '';
ok('pre-push actually runs the gate suite', /tools\/gates\.js/.test(body),
  'the hook exists but never invokes tools/gates.js');
ok('and it fails the push when a gate fails', /exit 1/.test(body),
  'the hook runs the suite but does not stop the push on failure');
/* The worktree trap: no tools/node_modules means every browser gate dies. A hook that skipped
   quietly there would hand back a green push that ran almost nothing. */
ok('and it refuses to pass when the browser gates cannot run',
  /node_modules/.test(body) && /exit 1/.test(body),
  'a worktree without tools/node_modules would push unverified');

/* Nov 2026: the hook reads git's stdin and makes two decisions with it. A push that changes product code
   with no test is stopped (tools/change_test_check.js), and a push that touches the rules, the Worker or
   the Firestore layer runs the emulator tier, which ran nowhere automatically before. Behaviour is proven
   by test/prepush-tier.test.js in a throwaway repo; these lines only stop the wiring being edited out. */
const hookAsks = (b) => ({
  changeTest: /tools\/change_test_check\.js"? --stdin/.test(b) && /change_test_check[\s\S]*?exit 1/.test(b),
  tier: /--stdin --tier/.test(b) && /GATE_ARGS="--emulator"/.test(b) && /gates\.js"? \$GATE_ARGS/.test(b),
  /* test/node_modules refused BEFORE the stdin is read and any gate runs: the first security push of
     Nov 2026 died 56 minutes in on its absence. */
  /* The java guard asks java to RUN. `command -v java` is always true on a Mac (Apple's /usr/bin/java stub). */
  javaRuns: (() => { const code = b.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');   // comments may name the old way
    return /JAVA_BIN[^\n]*-version/.test(code) && !/command -v java/.test(code); })(),
  testModsFirst: (() => { const g = b.search(/!\s*-d\s+"\$ROOT\/test\/node_modules"/), c = b.indexOf('RANGES=$(cat)');
    return g >= 0 && c > g && /test\/node_modules"[\s\S]*?exit 1/.test(b.slice(g)); })(),
});
const asks = hookAsks(body);
ok('pre-push stops a product change that came with no test (change_test_check.js --stdin)', asks.changeTest,
  'the hook never asks tools/change_test_check.js, or does not stop the push when it says no');
ok('and runs the emulator tier when the push touches the rules, the Worker or the Firestore layer', asks.tier,
  'the hook never passes --emulator to tools/gates.js, so the Firestore suites run nowhere before a deploy');
ok('and, for the emulator tier, refuses unless java actually runs (not just exists)', asks.javaRuns,
  'the hook checks for java with command -v, which Apple\'s /usr/bin/java stub always satisfies');
ok('and refuses up front, before any gate, when test/node_modules is missing', asks.testModsFirst,
  'the hook only finds out test/node_modules is gone when a suite needs it, maybe an hour in');

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
  console.log('\nself-test: the same assertions against a hook that does nothing');
  const fake = '#!/bin/sh\necho "I look like a hook"\nexit 0\n';
  const runsSuite = /tools\/gates\.js/.test(fake);
  const stops = /exit 1/.test(fake);
  ok('a hook that never calls gates.js is caught', runsSuite === false);
  const oldHook = '#!/bin/sh\nROOT=$(git rev-parse --show-toplevel)\nif ! node "$ROOT/tools/gates.js"; then exit 1; fi\n';
  ok('a hook that runs the suite but never asks change_test_check.js is caught', hookAsks(oldHook).changeTest === false);
  ok('a hook that never passes --emulator is caught', hookAsks(oldHook).tier === false);
  const stubGuard = '#!/bin/sh\nif ! command -v java >/dev/null 2>&1 && [ -z "$JAVA_HOME" ]; then exit 1; fi\n';
  ok('a java guard that only asks whether java exists (command -v) is caught', hookAsks(stubGuard).javaRuns === false && hookAsks(oldHook).javaRuns === false);
  const lateGuard = '#!/bin/sh\nRANGES=$(cat)\nif [ ! -d "$ROOT/test/node_modules" ]; then exit 1; fi\nnode "$ROOT/tools/gates.js"\n';
  ok('a hook that checks test/node_modules only after reading the push (or never) is caught',
    hookAsks(oldHook).testModsFirst === false && hookAsks(lateGuard).testModsFirst === false);
  ok('a hook that cannot stop a push is caught', stops === false);
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
