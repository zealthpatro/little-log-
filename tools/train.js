#!/usr/bin/env node
/* The daily merge train (docs/RELEASE-TRAIN.md).
 *
 * A merge to main is a deploy. The train turns N green PRs into ONE merge: it merges every green, non-draft
 * PR into a local train branch cut from origin/main, makes the service-worker CACHE end above production's,
 * and ships that once.
 *
 *   node tools/train.js             build the train branch locally and report; pushes nothing
 *   node tools/train.js --go        same, then push train/<stamp> and open its PR into main (gh pr create)
 *   node tools/train.js --self-test stage the conflicts it must handle in a temp repo, then judge
 *
 * --go never pushes main. It used to (`git push origin train/<stamp>:main`), and main's protection (required
 * checks, strict, enforce_admins) refuses that, after the pre-push hook had run the full suite for 104-140
 * min. The hook now refuses a main ref up front too. The train's PR is the run: its CI goes green, then the
 * release root merges it (gh pr merge --merge, never auto-merge).
 *
 * Every branch bumps CACHE (pre-commit demands it), so two PRs collide on that one line. The train
 * settles a conflict ONLY when app/sw.js is the sole conflicted file and the CACHE line is the sole
 * conflicting hunk; anything else aborts that merge and leaves the PR for its own chat to rebase.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_RE = /CACHE *= *'little-log-v(\d+)'/;
const OK_CHECK = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/* A PR rides the train when it is open, not a draft, targets main, and every check finished green.
   No checks at all is NOT green: a PR whose CI never ran has proved nothing. */
function isGreen(pr) {
  if (!pr || pr.isDraft || pr.baseRefName !== 'main') return false;
  const checks = pr.statusCheckRollup || [];
  if (!checks.length) return false;
  return checks.every((c) => OK_CHECK.has(String(c.conclusion || c.state || '').toUpperCase()));
}

function cacheOf(text) {
  const m = CACHE_RE.exec(text || '');
  return m ? Number(m[1]) : null;
}

/* Given sw.js with conflict markers, return the resolved text when every conflict hunk is only the CACHE
   line (taking the higher version), else null. */
function resolveSwConflict(text) {
  const hunk = /<<<<<<< [^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> [^\n]*\n/g;
  let ok = true;
  const out = text.replace(hunk, (_, ours, theirs) => {
    const a = ours.trim(), b = theirs.trim();
    const va = cacheOf(a), vb = cacheOf(b);
    if (va == null || vb == null || a.split('\n').length !== 1 || b.split('\n').length !== 1) { ok = false; return _; }
    return (va >= vb ? ours : theirs);
  });
  if (!ok || /^(<<<<<<<|=======|>>>>>>>)/m.test(out)) return null;
  return out;
}

function makeGit(cwd) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k]; // never inherit a hook's GIT_DIR
  return (args, opts = {}) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

/* Merge each PR head into the current branch. Returns { merged:[], skipped:[{pr, why}] }. */
function mergeAll(git, cwd, prs) {
  const merged = [], skipped = [];
  for (const pr of prs) {
    try {
      git(['merge', '--no-ff', '--no-edit', '-m', `Train: #${pr.number} ${pr.title}`, pr.ref]);
      merged.push(pr);
      continue;
    } catch (_) { /* conflict, or something worse: look */ }
    let conflicted = [];
    try { conflicted = git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean); } catch (_) {}
    const sw = path.join(cwd, 'app/sw.js');
    const fixed = conflicted.length === 1 && conflicted[0] === 'app/sw.js' ? resolveSwConflict(fs.readFileSync(sw, 'utf8')) : null;
    if (fixed) {
      fs.writeFileSync(sw, fixed);
      git(['add', 'app/sw.js']);
      git(['commit', '--no-verify', '--no-edit']); // a merge commit; pre-commit already ran on both sides
      merged.push(pr);
    } else {
      try { git(['merge', '--abort']); } catch (_) {}
      skipped.push({ pr, why: conflicted.length ? `conflicts in ${conflicted.join(', ')}` : 'merge failed' });
    }
  }
  return { merged, skipped };
}

/* After the merges, CACHE must sit above production's if any PR rode. Two PRs that both bumped to the
   same number merge clean at that number; that is still above production, which is all a returning
   phone needs. Only if it is not above (a PR that never bumped) does the train bump it. */
function ensureCacheAbove(git, cwd, baseVersion) {
  const sw = path.join(cwd, 'app/sw.js');
  const text = fs.readFileSync(sw, 'utf8');
  const v = cacheOf(text);
  if (v != null && v > baseVersion) return v;
  const next = baseVersion + 1;
  fs.writeFileSync(sw, text.replace(CACHE_RE, `CACHE = 'little-log-v${next}'`));
  git(['commit', '-o', 'app/sw.js', '-m', `Train: CACHE to v${next}`, '--no-verify']);
  return next;
}

/* deps: { cwd, gh(args) -> stdout, log }. The self-test passes its own gh and a temp repo; nothing else does. */
function run(go, deps = {}) {
  const cwd = deps.cwd || process.cwd();
  const git = makeGit(cwd);
  const gh = deps.gh || ((args) => execFileSync('gh', args, { cwd, encoding: 'utf8' }));
  const console = deps.log ? { log: deps.log, error: deps.log } : global.console;
  if (git(['status', '--porcelain'])) { console.error('✋ Working tree not clean. The train needs a clean checkout.'); if (deps.cwd) return { error: 'dirty' }; process.exit(1); }
  git(['fetch', 'origin', 'main']);
  const raw = gh(['pr', 'list', '--state', 'open', '--base', 'main', '--limit', '50',
    '--json', 'number,title,headRefName,isDraft,baseRefName,statusCheckRollup']);
  const all = JSON.parse(raw);
  const green = all.filter(isGreen).sort((a, b) => a.number - b.number);
  const waiting = all.filter((p) => !isGreen(p));
  console.log(`▸ ${all.length} open PRs: ${green.length} green, ${waiting.length} not ready`);
  for (const p of waiting) console.log(`   waiting  #${p.number} ${p.title}${p.isDraft ? ' (draft)' : ''}`);
  if (!green.length) { console.log('▸ Nothing to ship.'); return; }
  for (const p of green) git(['fetch', 'origin', `${p.headRefName}`]);
  const base = cacheOf(git(['show', 'origin/main:app/sw.js']));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const branch = `train/${stamp}`;
  git(['checkout', '-b', branch, 'origin/main']);
  const { merged, skipped } = mergeAll(git, cwd, green.map((p) => ({ number: p.number, title: p.title, ref: `origin/${p.headRefName}` })));
  for (const s of skipped) console.log(`   skipped  #${s.pr.number} ${s.pr.title}: ${s.why} (its chat rebases it)`);
  if (!merged.length) { console.log('▸ Every green PR conflicted. Nothing to ship.'); return; }
  const v = ensureCacheAbove(git, cwd, base);
  console.log(`▸ ${branch}: ${merged.length} PRs, CACHE v${base} → v${v}`);
  for (const m of merged) console.log(`   riding   #${m.number} ${m.title}`);
  if (!go) { console.log(`▸ Dry run. To ship: node tools/train.js --go (pushes ${branch} and opens its PR into main)`); return { branch, merged, skipped }; }
  console.log(`▸ Pushing ${branch} (a branch, never main: main takes merges through a PR with green checks).`);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  // The pre-push hook runs here (change-needs-test and the push lock; it refuses main, so this is never main).
  execFileSync('git', ['push', '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], { cwd, env, stdio: deps.cwd ? 'pipe' : 'inherit' });
  const body = ['Daily merge train (docs/RELEASE-TRAIN.md), cut from origin/main.', '', `CACHE v${base} → v${v}`, '', 'Riding:']
    .concat(merged.map((m) => `- #${m.number} ${m.title}`))
    .concat(skipped.length ? ['', 'Skipped (each chat rebases its own):'].concat(skipped.map((x) => `- #${x.pr.number} ${x.pr.title}: ${x.why}`)) : [])
    .join('\n');
  const url = String(gh(['pr', 'create', '--base', 'main', '--head', branch, '--title', `Train ${stamp}: ${merged.map((m) => '#' + m.number).join(' ')}`, '--body', body]) || '').trim();
  console.log(`▸ Opened ${url || 'the train PR'}. Its CI is the run: gh pr checks ${branch} --watch, then gh pr merge --merge (never auto-merge).`);
  console.log('▸ After it lands: node tools/gates.js --live, then confirm the live CACHE.');
  return { branch, merged, skipped, url };
}

/* ---------- self-test: every case must be able to go red ---------- */
function selfTest() {
  let fails = 0;
  const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`); if (!cond) fails++; };
  const chk = (c) => ({ conclusion: c });
  const pr = (o) => ({ isDraft: false, baseRefName: 'main', statusCheckRollup: [chk('SUCCESS')], ...o });

  ok(isGreen(pr({})), 'green PR rides');
  ok(!isGreen(pr({ isDraft: true })), 'draft waits');
  ok(!isGreen(pr({ statusCheckRollup: [] })), 'PR with no checks waits (CI never ran)');
  ok(!isGreen(pr({ statusCheckRollup: [chk('SUCCESS'), chk('FAILURE')] })), 'one red check holds the PR');
  ok(!isGreen(pr({ statusCheckRollup: [{ state: 'PENDING' }] })), 'pending check holds the PR');
  ok(!isGreen(pr({ baseRefName: 'other' })), 'PR not into main waits');

  // A real repo, two branches that both bump CACHE, one that also fights over a real file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-train-'));
  const git = makeGit(dir);
  const sw = (v, extra = '') => `const X = 1;\nconst CACHE = 'little-log-v${v}';\n${extra}const ASSETS = [];\n`;
  const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  try {
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']); git(['config', 'commit.gpgsign', 'false']);
    write('app/sw.js', sw(100)); write('app/a.js', 'a\n'); write('app/b.js', 'b\n');
    git(['add', '.']); git(['commit', '-qm', 'base']);
    const branch = (name, v, f, body) => {
      git(['checkout', '-qb', name, 'main']);
      write('app/sw.js', sw(v)); write(f, body); git(['add', '.']); git(['commit', '-qm', name]);
    };
    branch('one', 101, 'app/a.js', 'a one\n');
    branch('two', 102, 'app/b.js', 'b two\n');     // CACHE-only conflict with `one`: must merge
    branch('three', 101, 'app/a.js', 'a three\n'); // real conflict with `one` in a.js: must be skipped
    git(['checkout', '-qb', 'train', 'main']);
    const r = mergeAll(git, dir, [
      { number: 1, title: 'one', ref: 'one' }, { number: 2, title: 'two', ref: 'two' }, { number: 3, title: 'three', ref: 'three' }]);
    ok(r.merged.map((m) => m.number).join() === '1,2', `CACHE-only conflict merged (rode: ${r.merged.map((m) => m.number)})`);
    ok(r.skipped.length === 1 && r.skipped[0].pr.number === 3 && /app\/a\.js/.test(r.skipped[0].why), 'real conflict skipped, not forced');
    const text = fs.readFileSync(path.join(dir, 'app/sw.js'), 'utf8');
    ok(cacheOf(text) === 102 && !/<<<<<<<|>>>>>>>/.test(text), 'sw.js keeps the higher CACHE and no markers');
    ok(fs.readFileSync(path.join(dir, 'app/b.js'), 'utf8') === 'b two\n' && fs.readFileSync(path.join(dir, 'app/a.js'), 'utf8') === 'a one\n', 'both riders\' changes are in the train');
    ok(!git(['status', '--porcelain']), 'tree clean after a skipped merge (aborted, not left half-done)');
    ok(ensureCacheAbove(git, dir, 100) === 102, 'CACHE already above production is left alone');
    ok(ensureCacheAbove(git, dir, 102) === 103 && cacheOf(fs.readFileSync(path.join(dir, 'app/sw.js'), 'utf8')) === 103, 'CACHE not above production is bumped to production + 1');
    // A conflict that also touches another sw.js line is NOT a CACHE-only conflict.
    const mixed = `<<<<<<< a\nconst CACHE = 'little-log-v5';\nconst Y = 1;\n=======\nconst CACHE = 'little-log-v6';\nconst Y = 2;\n>>>>>>> b\n`;
    ok(resolveSwConflict(mixed) === null, 'sw.js conflict beyond the CACHE line is refused');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  /* --go, end to end: a bare origin with main and one green rider, a clone, and a gh that answers pr list and
     records pr create. The train must land as its own branch on origin with a PR opened from it, and origin's
     main must not move. (The train of 4e50b5e6 pushed train/<stamp>:main here and opened nothing.) */
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-train-go-'));
  try {
    const BARE = path.join(T, 'origin.git'), SEED = path.join(T, 'seed'), W = path.join(T, 'work');
    makeGit(T)(['init', '-q', '--bare', '-b', 'main', BARE]);
    fs.mkdirSync(SEED);
    const sg = makeGit(SEED);
    sg(['init', '-q', '-b', 'main']); sg(['config', 'user.email', 't@t']); sg(['config', 'user.name', 't']); sg(['config', 'commit.gpgsign', 'false']);
    const put = (d, f, txt) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), txt); };
    put(SEED, 'app/sw.js', "const CACHE = 'little-log-v200';\n"); put(SEED, 'app/a.js', 'a\n');
    sg(['add', '.']); sg(['commit', '-qm', 'base']); sg(['remote', 'add', 'origin', BARE]); sg(['push', '-q', 'origin', 'main']);
    sg(['checkout', '-qb', 'rider']); put(SEED, 'app/sw.js', "const CACHE = 'little-log-v201';\n"); put(SEED, 'app/a.js', 'a rider\n');
    sg(['commit', '-qam', 'rider']); sg(['push', '-q', 'origin', 'rider']);
    const mainBefore = makeGit(BARE)(['rev-parse', 'refs/heads/main']);
    makeGit(T)(['clone', '-q', BARE, W]);
    const wg = makeGit(W);
    wg(['config', 'user.email', 't@t']); wg(['config', 'user.name', 't']); wg(['config', 'commit.gpgsign', 'false']);
    const calls = [];
    const fakeGh = (args) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify([{ number: 7, title: 'rider', headRefName: 'rider', isDraft: false, baseRefName: 'main', statusCheckRollup: [chk('SUCCESS')] }]);
      if (args[0] === 'pr' && args[1] === 'create') return 'https://example.test/pull/8\n';
      return '';
    };
    const said = [];
    const res = run(true, { cwd: W, gh: fakeGh, log: (m) => said.push(String(m)) }) || {};
    const og = makeGit(BARE);
    const trainSha = res.branch ? (() => { try { return og(['rev-parse', 'refs/heads/' + res.branch]); } catch (_) { return ''; } })() : '';
    ok(og(['rev-parse', 'refs/heads/main']) === mainBefore, '--go leaves origin main where it was (it never pushes main)');
    ok(!!trainSha && og(['show', trainSha + ':app/a.js']) === 'a rider', `--go pushes the train branch itself to origin (${res.branch || 'no branch'})`);
    const create = calls.find((a) => a[0] === 'pr' && a[1] === 'create') || [];
    const flag = (f) => { const i = create.indexOf(f); return i >= 0 ? create[i + 1] : undefined; };
    ok(flag('--base') === 'main' && !!res.branch && flag('--head') === res.branch, '--go opens a PR from the train branch into main (gh pr create --base main --head train/<stamp>)');
    ok(/#7 rider/.test(flag('--body') || ''), 'and the PR body lists every rider');
    ok(calls.indexOf(create) > calls.findIndex((a) => a[1] === 'list') && !!trainSha, 'the PR is opened after the branch is on origin');
    ok(said.some((l) => /gh pr checks/.test(l)) && !said.some((l) => /:main\b/.test(l)), 'and it says the PR\'s checks are the run, never to push :main');
  } catch (e) {
    ok(false, '--go self-test ran to its end: ' + (e && e.stack || e));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }

  console.log(fails ? `TRAIN: FAIL (${fails})` : 'TRAIN: PASS');
  process.exit(fails ? 1 : 0);
}

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a.includes('--self-test')) selfTest();
  else run(a.includes('--go'));
}
module.exports = { isGreen, resolveSwConflict, cacheOf };
