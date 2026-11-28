#!/usr/bin/env node
/* What does CI run on a push to main, and what on a PR? Read from the workflows themselves.
 *
 *   node tools/ci_tier_check.js                 judge .github/workflows
 *   node tools/ci_tier_check.js --dir=<path>    judge another workflows directory (the red run: 4e50b5e6's)
 *   node tools/ci_tier_check.js --self-test     stage each way it must go red, then judge this tree
 *
 * WHY (28 Nov 2026, docs/TESTING.md, test-speed plan item 1). A push to main IS the deploy: Cloudflare has
 * served it before any job finishes, so a gates or emulator run there gates nothing. It was 38 runner-minutes
 * per merge re-grading the tree the PR had just graded. main takes merges only through a PR whose required
 * checks passed with strict=true (the branch must be up to date with main), so the PR run IS a run of the
 * merged tree. That only holds while strict=true: re-check it whenever protection changes
 *   gh api repos/zealthpatro/little-log-/branches/main/protection/required_status_checks --jq .strict
 *
 * THE RULE.
 *   push to main:  only the `live` job (production checks, after the deploy) and the seo IndexNow ping run.
 *   pull request:  gates, emulator, seo-guard (with its guard step) and teach-guard all run, because they are
 *                  the required checks; a required check whose job is skipped never reports, and the PR
 *                  waits forever (or, worse, someone loosens protection to get it in). `live` does not run.
 *
 * THE SPLIT (items 5-7). The tree tier runs as an N-way matrix (`tree`, gates.js --shard=i/N) and the emulator
 * tier as a 4-way one (`emulator-shard`); `tree-complete` and `emulator-complete` are what branch protection
 * requires. Each pair must hold together, or a gate can drop out of every shard while the check is green:
 *   the matrix lists every shard 1..N, does not fail fast (a red leg must not cancel the rest unrecorded), and
 *   each leg records its results; the aggregator needs the matrix and runs always() (a needed job that failed
 *   SKIPS a plain dependant, and a skipped required check counts as passed), passes the matrix's result as
 *   --legs, checks --of=N, and lists the gates with the very flags the legs ran with.
 *
 * THE TIER AND NO SWALLOWING (28 Nov 2026 skeptic). Matching legs to aggregator is not enough: both edited
 * together (--only=type, or --no-browser for --emulator-only) agreed and were green while grading one gate or no
 * Firestore suite. So each gates.js job's selecting flags are pinned exactly (TIER below), --mutants included
 * while plan item 14 is held on CI. And none of the six jobs, nor the step doing its work, may turn a failure
 * into a pass: no continue-on-error, no step if:, no shell:, no defaults:, and the step is the one command.
 *
 * HOW. A small YAML reader for the subset these files use (mappings, lists, flow lists, quoted scalars,
 * comments, block scalars), and an evaluator for `if:` that knows github.event_name and github.ref with
 * ==, !=, && and ||. Anything it cannot evaluate counts as "runs", so an unreadable condition fails the push
 * rule instead of passing it. Setup steps (uses: actions/*) are not work; every `run:` step is.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);

/* ---------- YAML, the subset the workflows use ---------- */
function scalar(v) {
  v = v.trim();
  if (v === '') return null;
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(v)) return v.slice(1, -1);
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((x) => scalar(x)).filter((x) => x !== null);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === "'" || c === '"') q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).replace(/\s+$/, '');
  }
  return line.replace(/\s+$/, '');
}
function parseYaml(text) {
  const raw = text.split('\n');
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const s = stripComment(raw[i]);
    if (!s.trim()) continue;
    lines.push({ ind: s.search(/\S/), text: s.trim(), n: i });
  }
  let i = 0;
  /* A block scalar (| or >): its value is every following line indented deeper. */
  const blockAfter = (ind) => { const out = []; while (i < lines.length && lines[i].ind > ind) out.push(lines[i++].text); return out.join('\n'); };
  function parseNode(ind) {
    if (i >= lines.length) return null;
    return lines[i].text.startsWith('- ') || lines[i].text === '-' ? parseList(lines[i].ind) : parseMap(lines[i].ind);
  }
  function parseMap(ind) {
    const out = {};
    while (i < lines.length && lines[i].ind === ind && !lines[i].text.startsWith('- ')) {
      const m = /^([^:]+?):(?:\s+(.*))?$/.exec(lines[i].text);
      if (!m) throw new Error('cannot read line ' + (lines[i].n + 1) + ': ' + lines[i].text);
      const key = scalar(m[1]), rest = m[2];
      i++;
      if (rest === undefined || rest === '') out[key] = (i < lines.length && lines[i].ind > ind) ? parseNode(lines[i].ind) : null;
      else if (/^[|>][-+]?$/.test(rest)) out[key] = blockAfter(ind);
      else out[key] = scalar(rest);
    }
    return out;
  }
  function parseList(ind) {
    const out = [];
    while (i < lines.length && lines[i].ind === ind && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
      const body = lines[i].text.replace(/^-\s*/, '');
      const itemInd = ind + 2;
      if (/^[^'"\[][^:]*:(\s|$)/.test(body)) {
        /* "- key: v" opens a map whose first key sits on the dash line. */
        lines[i] = { ind: itemInd, text: body, n: lines[i].n };
        out.push(parseMap(itemInd));
      } else { i++; out.push(scalar(body)); }
    }
    return out;
  }
  return parseNode(0);
}

/* ---------- `if:` under a given event ---------- */
function evalIf(expr, ctx) {
  if (expr === null || expr === undefined || expr === true) return true;
  if (expr === false) return false;
  let e = String(expr).trim().replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const atom = (a) => {
    a = a.trim().replace(/^\((.*)\)$/, '$1').trim();
    if (/^(always|success)\(\)$/.test(a)) return true;
    const m = /^(github\.event_name|github\.ref)\s*(==|!=)\s*'([^']*)'$/.exec(a);
    if (!m) return null;   // unknown: the caller treats it as "runs"
    const v = m[1] === 'github.event_name' ? ctx.event : ctx.ref;
    return m[2] === '==' ? v === m[3] : v !== m[3];
  };
  const ors = e.split('||').map((o) => o.split('&&').map(atom));
  if (ors.some((ands) => ands.some((x) => x === null))) return true;
  return ors.some((ands) => ands.every(Boolean));
}
function triggered(wf, ctx) {
  const on = wf.on !== undefined ? wf.on : wf.true;   // YAML 1.1 reads a bare `on` as true; our reader keeps the key
  if (!on) return false;
  const evs = typeof on === 'string' ? { [on]: null } : Array.isArray(on) ? Object.fromEntries(on.map((k) => [k, null])) : on;
  if (!(ctx.event in evs)) return false;
  const f = evs[ctx.event];
  if (ctx.event === 'push' && f && f.branches) return [].concat(f.branches).includes(ctx.ref.replace('refs/heads/', ''));
  return true;
}
/* Every job and work step that would run for ctx: [{ wf, job, steps: [names of run: steps] }]. */
function whatRuns(dir, ctx) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
    const wf = parseYaml(fs.readFileSync(path.join(dir, f), 'utf8')) || {};
    if (!triggered(wf, ctx)) continue;
    for (const [name, job] of Object.entries(wf.jobs || {})) {
      if (!evalIf(job && job.if, ctx)) continue;
      const steps = ((job && job.steps) || []).filter((s) => s && s.run !== undefined && evalIf(s.if, ctx))
        .map((s) => (s.name || '') + ' :: ' + String(s.run).split('\n')[0]);
      out.push({ wf: f, job: name, steps });
    }
  }
  return out;
}

const REQUIRED_ON_PR = { 'gates.yml': ['gates', 'emulator', 'tree', 'tree-complete', 'emulator-shard', 'emulator-complete'], 'seo.yml': ['seo-guard'], 'teach.yml': ['teach-guard'] };
/* [matrix job, aggregator job] in gates.yml. */
const SPLITS = [['tree', 'tree-complete'], ['emulator-shard', 'emulator-complete']];
/* A run line's words, with ${{ x }} kept as one word. */
const words = (run) => String(run || '').replace(/\$\{\{[^}]*\}\}/g, (m) => m.replace(/\s+/g, '')).split(/\s+/).filter(Boolean);
const legFlags = (ws) => ws.slice(ws.indexOf('tools/gates.js') + 1).filter((w) => !/^--(shard|record-times)=/.test(w)).sort();
/* THE TIER each gates.js job runs: its flags that choose WHICH gates, exactly (--shard and --record-times are the
   split's own, judged below). A -complete check must list with its matrix's set. Pinned, not only matched leg to
   aggregator: --only=type on both, or --no-browser for --emulator-only on both, agreed with itself and was green
   while it graded one gate or no Firestore suite (28 Nov 2026).
   --mutants everywhere: test-speed plan item 14 (mutation passes only where a PR touched their inputs) is held on
   CI until branch protection requires tree-complete and emulator-complete AND plan item 15 traces the inputs.
   Swapping --mutants for --changed=HEAD^1 here is that switch, made on purpose, once both hold. */
const TIER = {
  gates: ['--mutants', '--no-browser'],
  emulator: ['--emulator-only', '--mutants'],
  tree: ['--mutants'],
  'emulator-shard': ['--emulator-only', '--mutants'],
};
const same = (a, b) => JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
/* A required job, or the step that does its work, must not turn a failure into a pass: continue-on-error (job or
   step), a step `if:` that can skip it, or a `shell:` that can ignore its exit. And the step is the one command:
   `|| true` after it or `true;` before it is refused by shape, not only when it happens to break a flag match. */
function judgeWork(job, name, tool) {
  const out = [];
  if (!job) return out;
  const coe = (v) => v !== undefined && v !== null && v !== false;
  if (coe(job['continue-on-error'])) out.push(name + ' has continue-on-error: ' + job['continue-on-error'] + ': it would report success when it failed');
  if (job.defaults !== undefined) out.push(name + ' has a defaults: block: it can set a shell that ignores the exit of ' + tool);
  const step = (job.steps || []).find((s) => s && new RegExp('tools/' + tool.replace('.', '\\.')).test(String(s.run || '')));
  if (!step) return out;
  if (coe(step['continue-on-error'])) out.push(name + "'s " + tool + ' step has continue-on-error: ' + step['continue-on-error'] + ': the job goes green when ' + tool + ' fails');
  if (step.if !== undefined) out.push(name + "'s " + tool + ' step has if: ' + step.if + ': when it skips, the job passes without it');
  if (step.shell !== undefined) out.push(name + "'s " + tool + ' step has shell: ' + step.shell + ': a shell can ignore its exit');
  const run = String(step.run).trim();
  if (!new RegExp('^node tools/' + tool.replace('.', '\\.') + '(\\s+--\\S*)*$').test(run.replace(/\$\{\{[^}]*\}\}/g, 'X')) || /[;&|`]/.test(run.replace(/\$\{\{[^}]*\}\}/g, 'X')))
    out.push(name + "'s step is not only the " + tool + ' command (one line of --flags, nothing before or after): ' + run.slice(0, 200));
  return out;
}
function judgeSplits(wf) {
  const out = [];
  const jobs = (wf && wf.jobs) || {};
  if (wf && wf.defaults !== undefined) out.push('gates.yml has a defaults: block: it sets the shell of every step, and a shell can ignore an exit');
  for (const name of ['gates', 'emulator']) {
    const j = jobs[name];
    if (!j) continue;   // a missing required job is reported by the PR rule
    out.push(...judgeWork(j, name, 'gates.js'));
    const run = (j.steps || []).map((x) => x && x.run).find((r) => /tools\/gates\.js/.test(String(r || '')));
    const got = run ? words(run).slice(words(run).indexOf('tools/gates.js') + 1) : null;
    if (!got || !same(got, TIER[name])) out.push(name + ' runs gates.js with ' + JSON.stringify(got) + ', not exactly ' + JSON.stringify(TIER[name]) + ' (its tier, tools/ci_tier_check.js TIER)');
  }
  for (const [mj, aj] of SPLITS) {
    out.push(...judgeWork(jobs[mj], mj, 'gates.js'), ...judgeWork(jobs[aj], aj, 'shard.js'));
    const m = jobs[mj], a = jobs[aj];
    if (!m || !a) { out.push('gates.yml has no ' + (!m ? mj : aj) + ' job (the ' + mj + ' split and its ' + aj + ' check go together)'); continue; }
    const st = m.strategy || {};
    const shards = [].concat((st.matrix || {}).shard || []);
    const N = shards.length;
    if (!N || shards.some((x, k) => x !== k + 1)) out.push(mj + "'s matrix.shard is " + JSON.stringify(shards) + ', not 1..N: a shard that is not listed never runs');
    if (st['fail-fast'] !== false) out.push(mj + ' fails fast: one red leg cancels the others before they record what they held');
    const legRun = (m.steps || []).map((x) => x && x.run).find((r) => /tools\/gates\.js/.test(String(r || '')));
    const lw = words(legRun);
    if (!legRun) out.push(mj + ' has no gates.js step');
    else {
      if (!lw.includes('--shard=${{matrix.shard}}/' + N)) out.push(mj + ' does not run --shard=${{ matrix.shard }}/' + N + ' (' + lw.filter((w) => /^--shard/.test(w)).join(' ') + ')');
      if (!lw.some((w) => /^--record-times=/.test(w))) out.push(mj + ' records no results (--record-times): ' + aj + ' would have nothing to check');
      if (lw.filter((w) => /^--shard=/.test(w)).length > 1 || lw.filter((w) => /^--record-times=/.test(w)).length > 1) out.push(mj + ' passes --shard or --record-times twice: which one gates.js reads is not this check\'s to guess');
      if (!TIER[mj] || !same(legFlags(lw), TIER[mj])) out.push(mj + ' runs gates.js with ' + JSON.stringify(legFlags(lw)) + ', not exactly ' + JSON.stringify(TIER[mj] || null) + ' (its tier, tools/ci_tier_check.js TIER)');
    }
    const needs = [].concat(a.needs || []);
    if (!needs.includes(mj)) out.push(aj + ' does not need ' + mj + ': it could report before the shards ran');
    if (!/\balways\(\)/.test(String(a.if || ''))) out.push(aj + " has no always() in its if: when a leg fails, a plain dependant is SKIPPED, and a skipped required check passes");
    if (a.name !== undefined && a.name !== aj) out.push(aj + ' is named "' + a.name + '": branch protection requires the check by its name, ' + aj);
    const aggRun = (a.steps || []).map((x) => x && x.run).find((r) => /tools\/shard\.js/.test(String(r || '')));
    const aw = words(aggRun);
    if (!aggRun || !aw.some((w) => /^--complete=/.test(w))) out.push(aj + ' does not run tools/shard.js --complete');
    else {
      if (!aw.includes('--of=' + N)) out.push(aj + ' checks ' + (aw.find((w) => /^--of=/.test(w)) || 'no --of') + ', but ' + mj + ' has ' + N + ' shards');
      if (!aw.includes('--legs=${{needs.' + mj + '.result}}')) out.push(aj + ' does not pass --legs=${{ needs.' + mj + '.result }}: a failed or cancelled leg would go unread');
      const af = aw.indexOf('--') >= 0 ? aw.slice(aw.indexOf('--') + 1).sort() : null;
      if (legRun && JSON.stringify(af) !== JSON.stringify(legFlags(lw))) out.push(aj + ' lists the gates with ' + JSON.stringify(af) + ' but the legs ran ' + JSON.stringify(legFlags(lw)) + ': it would check another list');
      if (!af || !TIER[mj] || !same(af, TIER[mj])) out.push(aj + ' lists the gates with ' + JSON.stringify(af) + ', not exactly ' + JSON.stringify(TIER[mj] || null) + ' (' + mj + "'s tier): it would prove a smaller list complete");
    }
  }
  return out;
}
/* test/'s dependencies install from the committed lockfile (28 Nov 2026, PR #16 review). With only package.json
   behind them, a CI cache miss resolved newer in-range versions than the Mac runs, and the cache key, hashed on
   package.json alone, never noticed the difference. So: every install into test/ is `npm ci` (it refuses a lock
   out of step with package.json, and installs only what the lock names), every cache of test/node_modules or of
   the emulator jar keys on test/package-lock.json, and the lock is there, not ignored, and agrees with
   package.json. */
function judgeTestDeps(wf) {
  const out = [];
  for (const [name, j] of Object.entries((wf && wf.jobs) || {})) for (const st of (j && j.steps) || []) {
    if (!st) continue;
    const run = String(st.run || '');
    if (/--prefix[ =]test\b/.test(run) && !/^npm ci --prefix test(\s+--\S+)*$/.test(run.trim()))
      out.push(name + ' installs test/ with "' + run.trim().slice(0, 120) + '", not npm ci: a cache miss could take versions the Mac does not run');
    const w = st.with || {};
    if (/actions\/cache/.test(String(st.uses || '')) && /test\/node_modules|firebase\/emulators/.test(String(w.path || ''))
        && !/hashFiles\('test\/package-lock\.json'\)/.test(String(w.key || '')))
      out.push(name + ' caches ' + w.path + ' under "' + w.key + '", not keyed on test/package-lock.json: a changed lock would restore the old tree');
  }
  return out;
}
function judgeLock(root) {
  const out = [];
  const lp = path.join(root, 'test', 'package-lock.json');
  if (!fs.existsSync(lp)) return ['test/package-lock.json is missing: npm ci cannot install test/, and nothing pins what CI runs to the Mac'];
  let lock, pkg;
  try { lock = JSON.parse(fs.readFileSync(lp, 'utf8')); pkg = JSON.parse(fs.readFileSync(path.join(root, 'test', 'package.json'), 'utf8')); }
  catch (e) { return ['test/package-lock.json or test/package.json could not be read: ' + e.message]; }
  const top = (lock.packages || {})[''] || {};
  for (const k of ['dependencies', 'devDependencies']) if (JSON.stringify(top[k] || {}) !== JSON.stringify(pkg[k] || {}))
    out.push('test/package-lock.json\'s ' + k + ' ' + JSON.stringify(top[k] || {}) + ' are not test/package.json\'s ' + JSON.stringify(pkg[k] || {}) + ': npm ci would refuse it');
  if (!(lock.lockfileVersion >= 2)) out.push('test/package-lock.json is lockfileVersion ' + lock.lockfileVersion + ', not 2 or 3: it does not list every package');
  /* The patterns that would ignore test/package-lock.json from each file. The root's own `/package-lock.json` is
     anchored to the root and does not, so it is not one of them. */
  const IGN = [[path.join(root, '.gitignore'), /^((\*\*\/)?package-lock\.json|\/?test\/package-lock\.json)$/],
    [path.join(root, 'test', '.gitignore'), /^\/?(\*\*\/)?package-lock\.json$/]];
  for (const [gi, re] of IGN) {
    if (!fs.existsSync(gi)) continue;
    const hit = fs.readFileSync(gi, 'utf8').split('\n').map((l) => l.trim()).find((l) => re.test(l));
    if (hit) out.push(path.relative(root, gi) + ' ignores "' + hit + '": the lockfile CI installs from would never be committed');
  }
  return out;
}
function judge(dir) {
  const problems = [];
  let push, pr;
  try {
    push = whatRuns(dir, { event: 'push', ref: 'refs/heads/main' });
    pr = whatRuns(dir, { event: 'pull_request', ref: 'refs/pull/1/merge' });
  } catch (e) { return ['the workflows could not be read: ' + e.message]; }
  for (const j of push) {
    if (j.wf === 'gates.yml' && j.job === 'live') continue;
    if (j.wf === 'seo.yml' && j.job === 'seo-guard') {
      const extra = j.steps.filter((s) => !/indexnow_ping\.py --changed/.test(s));
      if (extra.length) problems.push('push to main runs ' + j.wf + ':' + j.job + ' work beyond the IndexNow ping: ' + extra.join(' | '));
      continue;
    }
    problems.push('push to main runs ' + j.wf + ':' + j.job + ' (' + (j.steps.join(' | ') || 'no run steps') + '): it gates nothing, the deploy has already happened');
  }
  if (!push.some((j) => j.wf === 'gates.yml' && j.job === 'live')) problems.push('push to main no longer runs gates.yml:live (production checks after the deploy)');
  if (!push.some((j) => j.wf === 'seo.yml' && j.steps.some((s) => /indexnow_ping\.py --changed/.test(s)))) problems.push('push to main no longer pings IndexNow (seo.yml)');
  for (const [wf, jobs] of Object.entries(REQUIRED_ON_PR)) for (const job of jobs) {
    const j = pr.find((x) => x.wf === wf && x.job === job);
    if (!j) problems.push('a PR does not run ' + wf + ':' + job + ', a required check: it would never report and the PR could not merge');
    else if (!j.steps.length) problems.push('a PR runs ' + wf + ':' + job + ' with no work step');
  }
  const seoPr = pr.find((x) => x.wf === 'seo.yml' && x.job === 'seo-guard');
  if (seoPr && !seoPr.steps.some((s) => /seo_check\.py/.test(s))) problems.push('a PR runs seo-guard without its guard step (tools/seo_check.py)');
  if (pr.some((x) => x.wf === 'gates.yml' && x.job === 'live')) problems.push('a PR runs gates.yml:live, which checks production, not the PR');
  try { const gy = parseYaml(fs.readFileSync(path.join(dir, 'gates.yml'), 'utf8')); problems.push(...judgeSplits(gy), ...judgeTestDeps(gy)); }
  catch (e) { problems.push('gates.yml could not be read for its splits: ' + e.message); }
  return problems;
}

function report(dir) {
  const p = judge(dir).concat(judgeLock(ROOT));
  console.log('\nCI tiers: what a push to main and a PR run (' + path.relative(ROOT, dir) + ')\n');
  if (!p.length) console.log('  ok   push to main runs only live and the IndexNow ping; a PR runs every required check, and each split holds with its -complete check');
  for (const x of p) console.log('  FAIL ' + x);
  return p;
}

function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 600) : '')); } };
  const real = path.join(ROOT, '.github', 'workflows');
  const src = Object.fromEntries(fs.readdirSync(real).filter((f) => /\.ya?ml$/.test(f)).map((f) => [f, fs.readFileSync(path.join(real, f), 'utf8')]));
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-ci-tier-'));
  let k = 0;
  const stage = (edit) => { const d = path.join(T, 'w' + (k++)); fs.mkdirSync(d); for (const [f, s] of Object.entries(src)) { const t = edit(f, s); if (t !== null) fs.writeFileSync(path.join(d, f), t); } return d; };
  const must = (s, a, b) => { if (!s.includes(a)) throw new Error('plant does not apply: ' + a); return s.replace(a, b); };
  console.log('\nself-test: each way the rule can break, staged in a temp copy of the workflows\n');
  try {
    ok('the reader reads every real workflow', Object.keys(src).every((f) => parseYaml(src[f]) && parseYaml(src[f]).jobs), Object.keys(src));
    const gy = parseYaml(src['gates.yml']);
    ok('the reader finds gates.yml\'s jobs and the live job\'s if', !!gy.jobs.gates && !!gy.jobs.emulator && /github\.ref == 'refs\/heads\/main'/.test(gy.jobs.live.if || ''), JSON.stringify(Object.keys(gy.jobs)));
    const drop = (s) => s.split('\n').filter((l) => !/^\s+if: github\.event_name == 'pull_request'\s*$/.test(l)).join('\n');
    let p = judge(stage((f, s) => f === 'gates.yml' ? drop(s) : s));
    ok('gates and emulator on every push again (the job ifs dropped): red', p.some((x) => /gates\.yml:gates/.test(x)) && p.some((x) => /gates\.yml:emulator/.test(x)), p);
    p = judge(stage((f, s) => f === 'seo.yml' ? must(s, "      - name: Guard (broken links, social images, JSON-LD, sitemap)\n        if: github.event_name != 'push'\n", "      - name: Guard (broken links, social images, JSON-LD, sitemap)\n") : s));
    ok('the seo guard step on push again: red, naming the extra step', p.some((x) => /seo-guard work beyond the IndexNow ping/.test(x) && /seo_check/.test(x)), p);
    p = judge(stage((f, s) => f === 'teach.yml' ? must(s, 'on:\n  pull_request:\n', 'on:\n  push:\n    branches: [main]\n  pull_request:\n') : s));
    ok('teach-guard on push again: red', p.some((x) => /teach\.yml:teach-guard/.test(x)), p);
    p = judge(stage((f, s) => f === 'gates.yml' ? s.replace(/^(\s+)if: github\.event_name == 'pull_request'\s*$/m, "$1if: github.event_name == 'push'") : s));
    ok('a required check that no longer runs on a PR: red (it would never report)', p.some((x) => /a PR does not run gates\.yml:gates/.test(x)), p);
    p = judge(stage((f, s) => f === 'gates.yml' ? s.replace(/^(\s+)if: github\.event_name == 'pull_request'\s*$/m, '$1if: ${{ contains(github.head_ref, \'x\') }}') : s));
    ok('an if it cannot evaluate counts as "runs": red on push', p.some((x) => /push to main runs gates\.yml:gates/.test(x)), p);
    p = judge(stage((f, s) => f === 'seo.yml' ? must(s, 'run: python3 tools/indexnow_ping.py --changed', 'run: echo nothing') : s));
    ok('the IndexNow ping gone from push: red', p.some((x) => /no longer pings IndexNow/.test(x)), p);
    p = judge(stage((f, s) => f === 'gates.yml' ? must(s, "if: github.event_name == 'push' && github.ref == 'refs/heads/main'", "if: github.event_name == 'pull_request' || github.ref == 'refs/heads/main'") : s));
    ok('live on a PR: red', p.some((x) => /a PR runs gates\.yml:live/.test(x)), p);
    /* The splits: each way a gate can fall out of every shard while the check stays green. */
    const G = (a, b) => stage((f, s) => (f === 'gates.yml' ? must(s, a, b) : s));
    const SP = [
      ['tree-complete without always() (a failed leg skips it, and skipped passes)', ["if: always() && github.event_name == 'pull_request'\n    needs: tree\n", "if: github.event_name == 'pull_request'\n    needs: tree\n"], /tree-complete has no always\(\)/],
      ['tree-complete checking 7 shards of 8', ['--of=8', '--of=7'], /tree-complete checks --of=7, but tree has 8 shards/],
      ['shard 8 left out of the matrix', ['shard: [1, 2, 3, 4, 5, 6, 7, 8]', 'shard: [1, 2, 3, 4, 5, 6, 7]'], /tree does not run --shard=\$\{\{ matrix\.shard \}\}\/7|tree-complete checks --of=8, but tree has 7/],
      ['the tree matrix failing fast', ['fail-fast: false\n      matrix:\n        shard: [1, 2, 3, 4, 5, 6, 7, 8]', 'fail-fast: true\n      matrix:\n        shard: [1, 2, 3, 4, 5, 6, 7, 8]'], /tree fails fast/],
      ['tree-complete listing with other flags than the legs', ['--of=8 --legs=${{ needs.tree.result }} -- --mutants', '--of=8 --legs=${{ needs.tree.result }} -- --no-browser --mutants'], /tree-complete lists the gates with/],
      ['tree-complete not reading the legs\' result', [' --legs=${{ needs.tree.result }}', ''], /does not pass --legs/],
      ['the legs recording nothing', [' --record-times=${{ runner.temp }}/results/shard-${{ matrix.shard }}-of-8.json', ''], /tree records no results/],
      ['emulator-complete checking 3 shards of 4', ['--of=4', '--of=3'], /emulator-complete checks --of=3, but emulator-shard has 4 shards/],
      ['emulator-complete renamed (protection would wait for a check that never reports)', ['  emulator-complete:\n    runs-on: ubuntu-latest\n', '  emulator-complete:\n    name: emulator complete\n    runs-on: ubuntu-latest\n'], /emulator-complete is named "emulator complete"/],
    ];
    for (const [label, [a, b], want] of SP) { const q = judge(G(a, b)); ok(label + ': red', q.some((x) => want.test(x)), q); }
    /* The tier each job runs, pinned exactly, and nothing that turns a failure into a pass (28 Nov 2026 skeptic:
       each of these was CI-TIER: PASS before). Several edits at once, because a pair edited together (the legs
       AND their -complete) is the case the flag-match rule alone cannot see. */
    const GG = (pairs) => stage((f, s) => (f === 'gates.yml' ? pairs.reduce((t, [a, b]) => must(t, a, b), s) : s));
    const TREE_STEP = '      - name: Every shard ran and passed, and each gate ran in exactly one\n';
    const EMU_STEP = '      - name: Every emulator shard ran and passed, and each suite ran in exactly one\n';
    const TP = [
      ['--only=type on both the tree legs and tree-complete (tree-complete would grade one gate)', [['/8 --mutants --record', '/8 --mutants --only=type --record'], ['-- --mutants\n', '-- --mutants --only=type\n']], /^tree runs gates\.js with .*--only=type/],
      ['--no-browser for --emulator-only on emulator-shard and emulator-complete (no Firestore suite would run)', [['gates.js --emulator-only --shard=', 'gates.js --no-browser --shard='], ['-- --emulator-only --mutants', '-- --no-browser --mutants']], /^emulator-shard runs gates\.js with .*--no-browser/],
      ['the tree pair on --changed=HEAD^1 (item 14 switched on before protection and the trace)', [['/8 --mutants --record', '/8 --changed=HEAD^1 --record'], ['-- --mutants\n', '-- --changed=HEAD^1\n']], /^tree runs gates\.js with .*--changed=HEAD\^1/],
      ['the required gates job without --mutants', [['gates.js --no-browser --mutants', 'gates.js --no-browser --changed=HEAD^1']], /^gates runs gates\.js with/],
      ['the required emulator job without --mutants', [['run: node tools/gates.js --emulator-only --mutants\n', 'run: node tools/gates.js --emulator-only\n']], /^emulator runs gates\.js with/],
      ['continue-on-error on the tree-complete step (green while shard.js says INCOMPLETE)', [[TREE_STEP, TREE_STEP + '        continue-on-error: true\n']], /^tree-complete's shard\.js step has continue-on-error/],
      ['continue-on-error on the tree-complete job', [['  tree-complete:\n    runs-on: ubuntu-latest\n', '  tree-complete:\n    runs-on: ubuntu-latest\n    continue-on-error: true\n']], /^tree-complete has continue-on-error/],
      ['continue-on-error on the emulator-complete job', [['  emulator-complete:\n    runs-on: ubuntu-latest\n', '  emulator-complete:\n    runs-on: ubuntu-latest\n    continue-on-error: true\n']], /^emulator-complete has continue-on-error/],
      ['continue-on-error on the required gates job', [['  gates:\n    runs-on: ubuntu-latest\n', '  gates:\n    runs-on: ubuntu-latest\n    continue-on-error: true\n']], /^gates has continue-on-error/],
      ['continue-on-error on a tree leg\'s gates.js step', [['      - name: Tree gates, one shard of 8\n', '      - name: Tree gates, one shard of 8\n        continue-on-error: true\n']], /^tree's gates\.js step has continue-on-error/],
      ['"|| true" after the tree-complete command', [['-- --mutants\n', '-- --mutants || true\n']], /^tree-complete's step is not only the shard\.js command/],
      ['a command before shard.js on the tree-complete step', [['run: node tools/shard.js --complete=${{ runner.temp }}/results --of=8', 'run: true; node tools/shard.js --complete=${{ runner.temp }}/results --of=8']], /^tree-complete's step is not only the shard\.js command/],
      ['an if: on the tree-complete step (skipped, and the job passes)', [[TREE_STEP, TREE_STEP + "        if: github.event_name == 'push'\n"]], /^tree-complete's shard\.js step has if/],
      ['a shell: on the emulator-complete step', [[EMU_STEP, EMU_STEP + '        shell: bash {0}\n']], /^emulator-complete's shard\.js step has shell/],
      ['a workflow defaults: block (it sets the shell of every step)', [['\njobs:\n', '\ndefaults:\n  run:\n    shell: bash {0}\n\njobs:\n']], /gates\.yml has a defaults: block/],
    ];
    for (const [label, pairs, want] of TP) { const q = judge(GG(pairs)); ok(label + ': red', q.some((x) => want.test(x)), q); }
    /* test/ from the lockfile: each way CI could drift from the Mac's tree, then the lock itself, staged. */
    const DP = [
      ['a tree leg back on npm install for test/', [["if: steps.test-deps.outputs.cache-hit != 'true'\n        run: npm ci --prefix test", "if: steps.test-deps.outputs.cache-hit != 'true'\n        run: npm install --prefix test"]], /^tree installs test\/ with "npm install --prefix test/],
      ['the emulator job on npm install for test/', [['      - name: Install firebase-tools and the rules-testing SDK (test/package-lock.json)\n        run: npm ci --prefix test', '      - name: Install firebase-tools and the rules-testing SDK (test/package-lock.json)\n        run: npm install --prefix test']], /^emulator installs test\/ with/],
      ['npm ci with something after it', [["if: steps.test-deps.outputs.cache-hit != 'true'\n        run: npm ci --prefix test --no-audit --no-fund", "if: steps.test-deps.outputs.cache-hit != 'true'\n        run: npm ci --prefix test --no-audit --no-fund && npm update --prefix test"]], /^tree installs test\/ with "npm ci --prefix test --no-audit --no-fund && npm update/],
      ['the test/ cache keyed on package.json again', [["test-deps-${{ runner.os }}-node22-${{ hashFiles('test/package-lock.json') }}", "test-deps-${{ runner.os }}-node22-${{ hashFiles('test/package.json') }}"]], /^tree caches test\/node_modules under .*not keyed on test\/package-lock\.json/],
      ['the emulator jar cache keyed on package.json again', [["firebase-emulators-${{ runner.os }}-${{ hashFiles('test/package-lock.json') }}", "firebase-emulators-${{ runner.os }}-${{ hashFiles('test/package.json') }}"]], /^tree caches ~\/\.cache\/firebase\/emulators under/],
    ];
    for (const [label, pairs, want] of DP) { const q = judge(GG(pairs)); ok(label + ': red', q.some((x) => want.test(x)), q); }
    const realLock = fs.readFileSync(path.join(ROOT, 'test', 'package-lock.json'), 'utf8');
    const realPkg = fs.readFileSync(path.join(ROOT, 'test', 'package.json'), 'utf8');
    const realGi = fs.readFileSync(path.join(ROOT, 'test', '.gitignore'), 'utf8');
    const rootGi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    const root = (lock, pkg, gi, rgi) => {
      const d = path.join(T, 'r' + (k++)); fs.mkdirSync(path.join(d, 'test'), { recursive: true });
      if (lock !== null) fs.writeFileSync(path.join(d, 'test', 'package-lock.json'), lock);
      fs.writeFileSync(path.join(d, 'test', 'package.json'), pkg);
      fs.writeFileSync(path.join(d, 'test', '.gitignore'), gi); fs.writeFileSync(path.join(d, '.gitignore'), rgi);
      return d;
    };
    const bumped = JSON.stringify(Object.assign(JSON.parse(realPkg), { devDependencies: Object.assign({}, JSON.parse(realPkg).devDependencies, { 'puppeteer-core': '^26.0.0' }) }), null, 2);
    const LP = [
      ['the lockfile missing', root(null, realPkg, realGi, rootGi), /test\/package-lock\.json is missing/],
      ['package.json moved on and the lock not (npm ci would refuse it)', root(realLock, bumped, realGi, rootGi), /devDependencies .* are not test\/package\.json's/],
      ['test/.gitignore ignoring the lock again', root(realLock, realPkg, realGi + 'package-lock.json\n', rootGi), /test\/\.gitignore ignores "package-lock\.json"/],
      ['the root .gitignore ignoring test/package-lock.json', root(realLock, realPkg, realGi, rootGi + 'test/package-lock.json\n'), /^\.gitignore ignores "test\/package-lock\.json"/],
    ];
    for (const [label, d, want] of LP) { const q = judgeLock(d); ok(label + ': red', q.some((x) => want.test(x)), q); }
    ok('companion: the real lock, package.json and ignores staged unaltered are green', judgeLock(root(realLock, realPkg, realGi, rootGi)).length === 0, judgeLock(root(realLock, realPkg, realGi, rootGi)));
    ok('companion: the unaltered copy is green', judge(stage((f, s) => s)).length === 0, judge(stage((f, s) => s)));
  } catch (e) { ok('the self-test ran to its end', false, e && e.stack || e); }
  finally { fs.rmSync(T, { recursive: true, force: true }); }
  const p = report(path.join(ROOT, '.github', 'workflows'));
  p.length ? fail++ : pass++;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  return fail;
}

if (require.main === module) {
  if (ARGS.includes('--self-test')) { const f = selfTest(); console.log('CI-TIER: ' + (f ? 'FAIL' : 'PASS')); process.exit(f ? 1 : 0); }
  const d = (ARGS.find((a) => a.startsWith('--dir=')) || '').slice(6);
  const p = report(d ? path.resolve(d) : path.join(ROOT, '.github', 'workflows'));
  console.log('\nCI-TIER: ' + (p.length ? 'FAIL' : 'PASS'));
  process.exit(p.length ? 1 : 0);
}
module.exports = { parseYaml, evalIf, whatRuns, judge, judgeSplits, judgeTestDeps, judgeLock };
