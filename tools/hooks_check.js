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
    const rel = path.relative(git('rev-parse --show-toplevel'), p).split(path.sep).join('/');
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

/* This gate can only ever report an ABSENCE of breakage, so on its own a green line is
   indistinguishable from a check that stopped checking. Stage the real failure and make the same
   predicate catch it. */
if (SELF_TEST) {
  console.log('\nself-test: the same assertions against a hook that does nothing');
  const fake = '#!/bin/sh\necho "I look like a hook"\nexit 0\n';
  const runsSuite = /tools\/gates\.js/.test(fake);
  const stops = /exit 1/.test(fake);
  ok('a hook that never calls gates.js is caught', runsSuite === false);
  ok('a hook that cannot stop a push is caught', stops === false);
  const deadPath = root + '/.git/hooks/pre-push';
  ok('an untracked hook path is caught', /\.githooks\//.test(deadPath) === false, deadPath);
  const m644 = execSync('git ls-tree HEAD -- CLAUDE.md', { encoding: 'utf8' }).split(/\s+/)[0];
  ok('a committed 100644 mode is caught (CLAUDE.md stands in)', m644 !== '100755', m644);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log('HOOKS: ' + (fail ? 'FAIL' : 'PASS') + '\n');
process.exit(fail ? 1 : 0);
