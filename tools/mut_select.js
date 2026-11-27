#!/usr/bin/env node
/* Which mutation passes run on this run: all of them nightly, and on a PR only those whose inputs changed.
 *
 *   used by tools/gates.js (--mutants, --changed=<rev>)
 *   node tools/mut_select.js --self-test     the selection rules, staged; then every mut gate's declared
 *                                            inputs checked against what its file really reads
 *
 * WHY (test-speed plan item 14, the founder's call of 28 Nov 2026: "mutation passes run nightly, plus on PRs
 * that touch what they guard"). A mutation pass breaks the code on purpose in a temp copy and requires the
 * suite to go red; it proves the suite can still see, not that the code is right. It cannot change its answer
 * unless the suite, the code it breaks or its helpers changed, and on one serial run they were about 40 min.
 * So a gate entry in tools/gates.js carries `mut: [inputs]`: paths (a trailing / is a directory) the pass
 * depends on. On a PR (or a local run) the pass runs when:
 *   - the gate is new (its name is not in the base's tools/gates.js), or its entry line changed, or
 *   - a changed file is one of its inputs, or
 *   - the change set cannot be known (no base, git fails), the runner code in tools/gates.js changed, or
 *     this file changed: then every pass runs. Unknown never means "skip".
 * Otherwise it is off: a gate whose command is suite + mutants (`--self-test`) runs as the suite alone, and a
 * pure mutation gate (`mutOnly: true`, e.g. usage-ingest-mut, whose suite is its own gate) does not run.
 * `--mutants` (nightly, tools/nightly.sh) runs every one, every night, so a loosened assertion is found within
 * 24 hours even when nothing it guards changed.
 *
 * The inputs are declared by hand until the traced input sets of plan item 15 exist. So that a declaration
 * cannot quietly fall behind its file, --self-test reads each mut gate's script, follows its relative
 * requires, and requires every repo path it names (a path literal, or a path.join of literals) to be covered
 * by an input. It cannot see a path built at run time; that is item 15's trace.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENTRY = /^\s*\{ name: '([^']+)'/;
/* name -> the entry's line text, from gates.js source. */
function entries(src) {
  const out = new Map();
  for (const l of String(src).split('\n')) { const m = ENTRY.exec(l); if (m) out.set(m[1], l.trim()); }
  return out;
}
/* gates.js without its entry lines: what is left is the runner. A change there selects every pass. */
/* Trimmed: git show's output (the base) has lost the file's last newline, the working file has not. */
const skeleton = (src) => String(src).split('\n').filter((l) => !ENTRY.test(l)).join('\n').trim();
const covers = (inputs, f) => (inputs || []).some((i) => (i.endsWith('/') ? f.startsWith(i) : f === i));

function cleanEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (k.startsWith('GIT_')) delete e[k]; return e; }
/* The change set: files changed between the base and this working tree (committed, staged, unstaged and
   untracked), and the base's tools/gates.js. rev given: that is the base (CI passes HEAD^1, main under the
   PR's merge commit). No rev: the merge-base of HEAD and origin/main. Any failure: { error }, and every pass
   runs. */
function changeSet(root, rev) {
  const git = (args) => execFileSync('git', args, { cwd: root, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const base = rev ? git(['rev-parse', '--verify', rev + '^{commit}']) : git(['merge-base', 'HEAD', 'origin/main']);
    const files = new Set(git(['diff', '--name-only', base]).split('\n').filter(Boolean));
    for (const f of git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) files.add(f);
    let baseSrc = null;
    try { baseSrc = git(['show', base + ':tools/gates.js']); } catch (e) { /* no gates.js there: every gate is new */ }
    return { base: base.slice(0, 12), label: rev || 'merge-base with origin/main', files: [...files], baseSrc };
  } catch (e) {
    return { error: String((e && e.stderr) || (e && e.message) || e).trim().split('\n')[0] };
  }
}

/* For each gate with `mut`: { run, why }. opts: { all, change, headSrc }. */
function plan(gates, opts) {
  const out = new Map();
  const mutGates = gates.filter((g) => g && g.mut);
  const every = (why) => { for (const g of mutGates) out.set(g.name, { run: true, why }); return out; };
  if (opts.all) return every('--mutants: every mutation pass');
  const c = opts.change || {};
  if (c.error) return every('change set unknown (' + c.error + '): every mutation pass');
  if (c.baseSrc === null || c.baseSrc === undefined) return every('no tools/gates.js at the base: every gate is new');
  if ((c.files || []).includes('tools/mut_select.js')) return every('tools/mut_select.js changed: every mutation pass');
  if (skeleton(c.baseSrc) !== skeleton(opts.headSrc)) return every('the runner in tools/gates.js changed: every mutation pass');
  const was = entries(c.baseSrc), now = entries(opts.headSrc);
  for (const g of mutGates) {
    const hit = (c.files || []).filter((f) => covers(g.mut, f));
    if (!was.has(g.name)) out.set(g.name, { run: true, why: 'new gate' });
    else if (was.get(g.name) !== now.get(g.name)) out.set(g.name, { run: true, why: 'its entry in tools/gates.js changed' });
    else if (hit.length) out.set(g.name, { run: true, why: 'input changed: ' + hit.slice(0, 3).join(', ') + (hit.length > 3 ? ' +' + (hit.length - 3) : '') });
    else out.set(g.name, { run: false, why: 'no input changed since ' + c.base });
  }
  return out;
}
/* The gate as this run runs it: itself, its suite alone (no --self-test), or null (a pure mutation gate, off). */
function apply(g, p) {
  if (!g.mut || !p || p.run) return g;
  if (g.mutOnly) return null;
  const strip = (a) => a && a.filter((x) => x !== '--self-test');
  return Object.assign({}, g, g.cmd ? { cmd: strip(g.cmd) } : {}, g.self ? { self: strip(g.self) } : {});
}

/* ---------- declared inputs against what the file reads ---------- */
const scriptOf = (g) => (g.cmd || g.self || []).find((a) => /^(tools|test)\/.+\.(js|mjs|py)$/.test(a));
/* Repo paths a file names: string literals that look like a path, and path.join(...) of literals from __dirname
   or the repo root. Returned repo-relative; only those that exist and are not node_modules. */
function namedPaths(root, rel, src) {
  const out = new Set();
  const keep = (p) => { p = p.replace(/^\.\//, '').replace(/\/$/, ''); if (!p || p === '.' || p.startsWith('..') || /node_modules/.test(p)) return;
    if (!/[/.]/.test(p)) return;   // a bare word ('app', 'test') is too often not a path; item 15 traces those
    if (fs.existsSync(path.join(root, p))) out.add(p); };
  for (const m of src.matchAll(/['"`]((?:app|workers|schema|tools|test|worker\.js|wrangler\.toml|firestore\.rules|storage\.rules|firebase\.json|\.assetsignore)(?:\/[A-Za-z0-9_.\-/]*)?)['"`]/g)) keep(m[1]);
  for (const m of src.matchAll(/path\.join\(([^()]*)\)/g)) {
    const args = m[1].split(',').map((x) => x.trim());
    let base;
    if (args[0] === '__dirname') base = path.posix.dirname(rel);
    else if (/^(ROOT|REPO|root)$/.test(args[0])) base = '';
    else continue;
    const segs = [];
    for (const a of args.slice(1)) { const q = /^['"]([^'"]+)['"]$/.exec(a); if (!q) break; segs.push(q[1]); }
    if (segs.length) keep(path.posix.normalize(path.posix.join(base || '.', ...segs)));
  }
  return [...out];
}
/* A file and every file it reaches by a relative require, repo-relative. */
function requireClosure(root, rel) {
  const seen = new Set(), todo = [rel];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    let src;
    try { src = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
    seen.add(f);
    for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      let t = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      if (!/\.(js|mjs|json)$/.test(t)) t += '.js';
      if (!/node_modules/.test(t)) todo.push(t);
    }
  }
  return [...seen];
}
/* What a mut gate reads that its inputs do not cover: [{ file, path }]. */
function gaps(root, g) {
  const s = scriptOf(g);
  if (!s) return [{ file: '(entry)', path: 'no tools/ or test/ script in its command' }];
  const out = [];
  for (const f of requireClosure(root, s)) {
    if (!covers(g.mut, f)) out.push({ file: f, path: f });
    let src = '';
    try { src = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
    for (const p of namedPaths(root, f, src)) {
      const isDir = fs.statSync(path.join(root, p)).isDirectory();
      if (!covers(g.mut, isDir ? p + '/' : p)) out.push({ file: f, path: p + (isDir ? '/' : '') });
    }
  }
  return out;
}

function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 900) : '')); } };
  const ROOT = path.join(__dirname, '..');
  console.log('\nmutation passes: nightly every one, on a PR only what its change touched\n');

  const head = "const X = 1;\nconst TREE = [\n  { name: 'a', cmd: ['node', 'test/a.test.js', '--self-test'], mut: ['test/a.test.js', 'workers/'] },\n" +
    "  { name: 'b-mut', cmd: ['node', 'test/b.test.js', '--self-test'], mut: ['test/b.test.js'], mutOnly: true },\n  { name: 'plain', cmd: ['node', 'test/p.js'] },\n];\n";
  const gates = [{ name: 'a', cmd: ['node', 'test/a.test.js', '--self-test'], mut: ['test/a.test.js', 'workers/'] },
    { name: 'b-mut', cmd: ['node', 'test/b.test.js', '--self-test'], mut: ['test/b.test.js'], mutOnly: true }, { name: 'plain', cmd: ['node', 'test/p.js'] }];
  const P = (o) => plan(gates, Object.assign({ headSrc: head }, o));
  let p = P({ change: { base: 'b0', files: ['docs/x.md'], baseSrc: head } });
  ok('1. an unrelated change: both passes off', p.get('a').run === false && p.get('b-mut').run === false && !p.has('plain'), [...p]);
  ok('1. off means the suite alone for a, nothing for b-mut, and plain untouched',
    apply(gates[0], p.get('a')).cmd.join(' ') === 'node test/a.test.js' && apply(gates[1], p.get('b-mut')) === null && apply(gates[2], p.get('plain')) === gates[2]);
  p = P({ all: true, change: { base: 'b0', files: [], baseSrc: head } });
  ok('2. --mutants: every pass, as nightly runs them', p.get('a').run && p.get('b-mut').run && apply(gates[0], p.get('a')) === gates[0], [...p]);
  p = P({ change: { base: 'b0', files: ['workers/admin/src/x.mjs'], baseSrc: head } });
  ok('3. a file under an input directory selects that pass only', p.get('a').run && !p.get('b-mut').run && /workers\/admin/.test(p.get('a').why), [...p]);
  p = P({ change: { base: 'b0', files: ['workersX/y.js', 'test/a.test.jsx'], baseSrc: head } });
  ok('3. companion: whole paths, not prefixes (workersX/, a.test.jsx select nothing)', !p.get('a').run, [...p]);
  p = P({ change: { base: 'b0', files: [], baseSrc: head.replace(/  \{ name: 'b-mut'[^\n]*\n/, '') } });
  ok('4. a gate the base does not have is new, and runs', p.get('b-mut').run && p.get('b-mut').why === 'new gate' && !p.get('a').run, [...p]);
  p = P({ change: { base: 'b0', files: ['tools/gates.js'], baseSrc: head.replace("mut: ['test/a.test.js', 'workers/']", "mut: ['test/a.test.js']") } });
  ok('5. a changed entry line (its inputs widened) runs that pass', p.get('a').run && /entry/.test(p.get('a').why) && !p.get('b-mut').run, [...p]);
  p = P({ change: { base: 'b0', files: [], baseSrc: head.trim() } });
  ok('6. companion: the base as git show prints it (no last newline) is not a runner change', !p.get('a').run && !p.get('b-mut').run, [...p]);
  p = P({ change: { base: 'b0', files: ['tools/gates.js'], baseSrc: head.replace('const X = 1;', 'const X = 2;') } });
  ok('6. a change to the runner outside the entries: every pass', p.get('a').run && p.get('b-mut').run && /runner/.test(p.get('a').why), [...p]);
  p = P({ change: { error: 'fatal: bad revision' } });
  ok('7. a change set it cannot know: every pass, never "skip"', p.get('a').run && p.get('b-mut').run && /unknown/.test(p.get('a').why), [...p]);
  p = P({ change: { base: 'b0', files: [], baseSrc: null } });
  ok('7. no gates.js at the base: every pass', p.get('a').run && p.get('b-mut').run, [...p]);
  p = P({ change: { base: 'b0', files: ['tools/mut_select.js'], baseSrc: head } });
  ok('7. this file changed: every pass', p.get('a').run && p.get('b-mut').run, [...p]);

  /* changeSet against real git, in a temp repo. */
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-mutsel-'));
  try {
    const g = (args) => execFileSync('git', args, { cwd: T, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'commit.gpgsign', 'false']);
    fs.mkdirSync(path.join(T, 'tools')); fs.writeFileSync(path.join(T, 'tools', 'gates.js'), head); fs.writeFileSync(path.join(T, 'r.md'), 'x\n');
    g(['add', '.']); g(['commit', '-qm', 'base']);
    fs.writeFileSync(path.join(T, 'r.md'), 'y\n'); g(['commit', '-qam', 'two']);
    fs.mkdirSync(path.join(T, 'workers')); fs.writeFileSync(path.join(T, 'workers', 'new.mjs'), 'z\n');   // untracked
    let c = changeSet(T, 'HEAD^1');
    ok('8. changeSet(HEAD^1): the committed change and the untracked file, and the base gates.js', !c.error && c.files.includes('r.md') && c.files.includes('workers/new.mjs') && c.baseSrc === head.trim(), c);
    ok('8. so a pass over workers/ runs off a file not yet added', plan(gates, { headSrc: head, change: Object.assign({}, c, { baseSrc: head }) }).get('a').run);
    c = changeSet(T, 'no-such-rev');
    ok('8. a rev git cannot resolve is an error (every pass runs)', !!c.error, c);
    c = changeSet(T);
    ok('8. no origin/main and no rev: an error, not an empty change set', !!c.error, c);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }

  /* The declared inputs of THIS tree's mut gates, against what their files read. */
  const g2 = require('./gates.js');
  const mg = g2.TREE.concat(g2.EMU_GATES).filter((x) => x.mut);
  ok('9. tools/gates.js declares mutation passes (' + mg.map((x) => x.name).join(', ') + ')', mg.length >= 10, mg.length);
  for (const x of mg) {
    const gp = gaps(ROOT, x);
    ok('9. ' + x.name + ': its inputs cover its script, its relative requires and every repo path they name', gp.length === 0, gp.map((q) => q.file + ' -> ' + q.path).join('\n'));
  }
  /* Companion: the same matcher, given a gate whose inputs leave out what its file reads, names the gap. */
  const narrow = Object.assign({}, mg.find((x) => x.name === 'admin-access') || mg[0]);
  narrow.mut = [scriptOf(narrow)];
  const ng = gaps(ROOT, narrow);
  ok('9. companion: ' + narrow.name + ' declared as only its own file is flagged (helpers, workers)',
    ng.some((q) => /^test\/helpers\//.test(q.path)) && ng.some((q) => /^workers\//.test(q.path)), ng.map((q) => q.path));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('MUT-SELECT: ' + (fail ? 'FAIL' : 'PASS'));
  return fail;
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exit(selfTest() ? 1 : 0);
  console.log('usage: node tools/mut_select.js --self-test   (tools/gates.js uses it; see the header)');
}
module.exports = { entries, skeleton, covers, changeSet, plan, apply, gaps, namedPaths, requireClosure };
