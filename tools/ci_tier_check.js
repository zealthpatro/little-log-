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
function judgeSplits(wf) {
  const out = [];
  const jobs = (wf && wf.jobs) || {};
  for (const [mj, aj] of SPLITS) {
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
    }
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
  try { problems.push(...judgeSplits(parseYaml(fs.readFileSync(path.join(dir, 'gates.yml'), 'utf8')))); }
  catch (e) { problems.push('gates.yml could not be read for its splits: ' + e.message); }
  return problems;
}

function report(dir) {
  const p = judge(dir);
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
      ['tree-complete listing with other flags than the legs', ['--of=8 --legs=${{ needs.tree.result }} -- --changed=HEAD^1', '--of=8 --legs=${{ needs.tree.result }} -- --no-browser --changed=HEAD^1'], /tree-complete lists the gates with/],
      ['tree-complete not reading the legs\' result', [' --legs=${{ needs.tree.result }}', ''], /does not pass --legs/],
      ['the legs recording nothing', [' --record-times=${{ runner.temp }}/results/shard-${{ matrix.shard }}-of-8.json', ''], /tree records no results/],
      ['emulator-complete checking 3 shards of 4', ['--of=4', '--of=3'], /emulator-complete checks --of=3, but emulator-shard has 4 shards/],
      ['emulator-complete renamed (protection would wait for a check that never reports)', ['  emulator-complete:\n    runs-on: ubuntu-latest\n', '  emulator-complete:\n    name: emulator complete\n    runs-on: ubuntu-latest\n'], /emulator-complete is named "emulator complete"/],
    ];
    for (const [label, [a, b], want] of SP) { const q = judge(G(a, b)); ok(label + ': red', q.some((x) => want.test(x)), q); }
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
module.exports = { parseYaml, evalIf, whatRuns, judge, judgeSplits };
