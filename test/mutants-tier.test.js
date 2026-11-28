/* Does tools/gates.js run a mutation pass nightly always, and on a PR only when the PR touched what it guards?
 *
 *   node test/mutants-tier.test.js
 *   GATES_FROM=/path/to/old/tools/gates.js node test/mutants-tier.test.js   grade another runner (the red run:
 *     the runner of 4e50b5e6 ignores `mut` and runs every --self-test on every run)
 *
 * WHY (test-speed plan item 14, the founder's call of 28 Nov 2026). A mutation pass proves a suite can still see
 * a bug; it is about 40 serial minutes, and its answer can only change when the suite, the code it breaks or
 * their helpers change. So a PR runs it only then, and nightly (--mutants) runs every one. The danger is the
 * other direction: a selector that switches a pass off when it should not, or a nightly flag that does not
 * reach it. So this stages a REAL runner (the real tools/gates.js, tools/mut_select.js, tools/serve.js and
 * tools/gate_downloads.js) in a throwaway git repo with a bare origin, and plants two gates whose mutants find
 * a weakened assertion (their --self-test exits 1; their suite passes): `planted-mut`, suite + mutants in one
 * command, and `planted-mut-only`, a pure mutation gate. Then, on a branch:
 *   A. an unrelated change: both off, the run passes, planted-mut ran as the suite alone, planted-mut-only not at all
 *   B. the same with --mutants (what nightly passes): both run and the run is RED (the weakened assertion found)
 *   C. a change to an input of planted-mut: it runs (red); planted-mut-only stays off
 *   D. a new gate (not in origin/main's gates.js): it runs
 *   E. --changed=<a rev git does not know>: every pass runs (unknown never means skip)
 *   F. tools/nightly.sh passes --mutants on its real run and its dry run
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

for (const k of Object.keys(process.env)) if (/^GIT_/.test(k)) delete process.env[k];

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 1400).replace(/\n/g, '\n         ') : '')); } };

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-mutants-'));
const W = path.join(T, 'work'), BARE = path.join(T, 'origin.git'), CALLS = path.join(T, 'calls.txt');
const ENV = Object.assign({}, process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull });
const git = (args, cwd) => execFileSync('git', args, { cwd: cwd || W, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(W, p)), { recursive: true }); fs.writeFileSync(path.join(W, p), s); };

/* The planted gate: records each run's arguments; with --self-test its mutants find the weakened assertion. */
const GATE = "require('fs').appendFileSync(" + JSON.stringify(CALLS) + ", JSON.stringify(process.argv.slice(2)) + '\\n');\n" +
  "if (process.argv.includes('--self-test')) { console.log('mutant survived: the assertion was weakened'); process.exit(1); }\n" +
  "console.log('suite ok');\n";
const PLANT = "  { name: 'planted-mut', cmd: ['node', 'p/gate.js', 'one', '--self-test'], mut: ['p/gate.js', 'p/guarded/'] },\n" +
  "  { name: 'planted-mut-only', cmd: ['node', 'p/gate.js', 'two', '--self-test'], mut: ['p/gate.js', 'p/only.txt'], mutOnly: true },\n";
const NEWGATE = "  { name: 'planted-new', cmd: ['node', 'p/gate.js', 'three', '--self-test'], mut: ['p/gate.js'] },\n";
const runnerSrc = fs.readFileSync(process.env.GATES_FROM || path.join(ROOT, 'tools', 'gates.js'), 'utf8');
const withPlants = (extra) => { const at = runnerSrc.indexOf('const TREE = [\n'); if (at < 0) throw new Error('no TREE list to plant in');
  return runnerSrc.slice(0, at + 15) + PLANT + (extra || '') + runnerSrc.slice(at + 15); };

const calls = () => { try { return fs.readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } };
const ran = (c, tag) => c.filter((a) => a[0] === tag);
function gates(args) {
  try { fs.unlinkSync(CALLS); } catch (e) { /* none yet */ }
  const r = spawnSync(process.execPath, ['tools/gates.js', '--no-browser', '--only=planted'].concat(args || []), { cwd: W, env: ENV, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), calls: calls() };
}

console.log('\nmutation passes: nightly every one (--mutants), on a PR only what the PR touched\n');
try {
  fs.mkdirSync(W);
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'mut@example.test']); git(['config', 'user.name', 'mutants test']); git(['config', 'commit.gpgsign', 'false']);
  w('tools/gates.js', withPlants());
  for (const f of ['tools/mut_select.js', 'tools/serve.js', 'tools/gate_downloads.js', 'app/index.html', 'app/store-firebase.js', 'app/sw.js']) {
    if (fs.existsSync(path.join(ROOT, f))) w(f, fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }
  w('p/gate.js', GATE); w('p/guarded/a.txt', '1\n'); w('p/only.txt', '1\n'); w('docs/notes.md', 'words\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'root']);
  git(['init', '-q', '--bare', BARE]); git(['remote', 'add', 'origin', BARE]); git(['push', '-q', 'origin', 'main']); git(['fetch', '-q', 'origin']);

  /* A. An unrelated change. */
  git(['checkout', '-q', '-b', 'docs-only']);
  w('docs/notes.md', 'more words\n'); git(['commit', '-q', '-am', 'docs']);
  let r = gates();
  ok('A. an unrelated change: the run passes (both mutation passes off)', r.code === 0 && /GATES: PASS/.test(r.out), r.out.slice(-1400));
  ok('A. planted-mut ran as its suite alone (no --self-test)', ran(r.calls, 'one').length === 1 && !ran(r.calls, 'one')[0].includes('--self-test'), JSON.stringify(r.calls));
  ok('A. planted-mut-only did not run', ran(r.calls, 'two').length === 0, JSON.stringify(r.calls));
  ok('A. and the run says which passes are off and that nightly runs them', /off, nightly runs them \(--mutants\): [^\n]*planted-mut/.test(r.out), r.out.slice(0, 1400));

  /* B. Nightly. */
  r = gates(['--mutants']);
  ok('B. --mutants (nightly): both passes run with --self-test', ran(r.calls, 'one').some((a) => a.includes('--self-test')) && ran(r.calls, 'two').some((a) => a.includes('--self-test')), JSON.stringify(r.calls));
  ok('B. and the weakened assertion turns the run RED', r.code === 1 && /GATES: FAIL/.test(r.out), r.out.slice(-800));

  /* C. An input of planted-mut changed. */
  git(['checkout', '-q', '-b', 'guarded', 'main']);
  w('p/guarded/a.txt', '2\n'); git(['commit', '-q', '-am', 'touch what planted-mut guards']);
  r = gates();
  ok('C. a PR that touches p/guarded/ runs planted-mut\'s mutants (and goes red on them)', ran(r.calls, 'one').some((a) => a.includes('--self-test')) && r.code === 1, JSON.stringify(r.calls) + '\n' + r.out.slice(-600));
  ok('C. planted-mut-only, which does not guard it, stays off', ran(r.calls, 'two').length === 0, JSON.stringify(r.calls));
  r = gates(['--changed=main']);
  ok('C. the same with an explicit --changed=main (what CI passes as HEAD^1)', ran(r.calls, 'one').some((a) => a.includes('--self-test')) && ran(r.calls, 'two').length === 0, JSON.stringify(r.calls));

  /* D. A new gate. */
  git(['checkout', '-q', '-b', 'new-gate', 'main']);
  w('tools/gates.js', withPlants(NEWGATE)); git(['commit', '-q', '-am', 'a new gate']);
  r = gates();
  ok('D. a gate origin/main does not have runs its mutants', ran(r.calls, 'three').some((a) => a.includes('--self-test')), JSON.stringify(r.calls) + '\n' + r.out.slice(0, 900));
  ok('D. and the gates beside it, untouched, stay off', ran(r.calls, 'two').length === 0, JSON.stringify(r.calls));

  /* E. A change set that cannot be known. */
  git(['checkout', '-q', 'docs-only']);
  r = gates(['--changed=no-such-rev']);
  ok('E. --changed=<unknown rev>: every pass runs (unknown never means skip)', ran(r.calls, 'one').some((a) => a.includes('--self-test')) && ran(r.calls, 'two').length === 1 && r.code === 1, JSON.stringify(r.calls) + '\n' + r.out.slice(0, 600));
} catch (e) {
  ok('the test ran to its end', false, e && e.stack || e);
} finally {
  try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

/* F. The nightly run passes --mutants, real and dry, or B above never happens at night. */
const nightly = fs.readFileSync(path.join(ROOT, 'tools', 'nightly.sh'), 'utf8');
const gateArgs = [...nightly.matchAll(/^\s*GATE_ARGS="([^"]*)"/gm)].map((m) => m[1]);
ok('F. tools/nightly.sh sets GATE_ARGS twice (dry run and real), each with --mutants', gateArgs.length === 2 && gateArgs.every((a) => /(^| )--mutants( |$)/.test(a)), gateArgs);
ok('F. and runs gates.js with $GATE_ARGS', /node tools\/gates\.js \$GATE_ARGS/.test(nightly), (nightly.match(/[^\n]*tools\/gates\.js[^\n]*/g) || []).join('\n'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log('MUTANTS-TIER: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
