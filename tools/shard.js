#!/usr/bin/env node
/* Split the gates across CI machines, and prove afterwards that every gate ran on one of them.
 *
 *   used by tools/gates.js --shard=i/N (and --list)
 *   node tools/shard.js --complete=<dir> --of=N --legs=<result> -- <gates.js flags>
 *                       CI's tree-complete and emulator-complete jobs: every shard's results file is
 *                       there, every gate passed, and the union of what the shards ran is exactly
 *                       `gates.js --list <the same flags>`, each gate once. --legs is needs.<matrix>.result.
 *   node tools/shard.js --times-from=<file>[,<file>...]
 *                       rebuild tools/gate-times.json from timing lines ("452.6 admin-ui", a full run's
 *                       ~/cubby-work/suite-times.txt) or --record-times files; a later file wins per gate
 *   node tools/shard.js --self-test
 *
 * WHY (test-speed plan items 5-7, 28 Nov 2026). The tree tier is 104 min run one gate at a time; split 8
 * ways on 8 machines it is the slowest shard, about 13-20 min. The hazard of a split is a gate that falls out
 * of every shard: the run is green because the gate never ran. So the split is a pure function of the gate
 * names and tools/gate-times.json (no clock, no randomness, no input order), every leg computes the same
 * one, and the aggregator checks the union against the runner's own list instead of trusting the legs.
 *
 * HOW. Longest first: the names are sorted by recorded seconds, slowest first, ties by name, and each goes
 * to the bin that holds the fewest seconds so far (the lowest-numbered bin on a tie). A gate with no
 * recorded time counts as UNKNOWN_S. Shard i of N (1-based) is bin i-1, in the order the list gave the
 * gates, so a gate that must follow another (usage-tracker-emu after rules) still does within its shard.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TIMES = path.join(__dirname, 'gate-times.json');
const UNKNOWN_S = 60;

/* The partition. One function holding all three, so the self-test can rebuild it from its own source with
   one line changed and require the properties to go red. */
function impl(UNKNOWN) {
  /* "i/N", 1 <= i <= N, both whole numbers. Anything else throws: a bad shard must never mean "ran
     nothing, passed". */
  function parseShard(spec) {
    const m = /^(\d+)\/(\d+)$/.exec(String(spec));
    if (!m) throw new Error('--shard wants i/N, e.g. --shard=3/8 (got "' + spec + '")');
    const i = Number(m[1]), n = Number(m[2]);
    if (n < 1 || i < 1 || i > n) throw new Error('--shard=' + spec + ': i must be 1..N and N at least 1');
    return { i, n };
  }
  function bins(names, n, times) {
    const t = (x) => (times && Object.prototype.hasOwnProperty.call(times, x) ? Number(times[x]) : UNKNOWN);
    const order = [...new Set(names)].sort((a, b) => t(b) - t(a) || (a < b ? -1 : a > b ? 1 : 0));
    const load = new Array(n).fill(0), out = Array.from({ length: n }, () => []);
    for (const name of order) {
      let best = 0;
      for (let bin = 1; bin < n; bin++) if (load[bin] < load[best]) best = bin;
      out[best].push(name);
      load[best] += t(name);
    }
    return out;
  }
  /* The names of shard `spec`, in list order. */
  function shardOf(names, spec, times) {
    const { i, n } = parseShard(spec);
    const keep = new Set(bins(names, n, times)[i - 1]);
    return names.filter((x) => keep.has(x));
  }
  return { parseShard, bins, shardOf };
}
const { parseShard, bins, shardOf } = impl(UNKNOWN_S);

/* tools/gate-times.json's { name: seconds }; {} when it is missing (every gate then counts UNKNOWN_S). */
function loadTimes(file) {
  try { return JSON.parse(fs.readFileSync(file || TIMES, 'utf8')).seconds || {}; } catch (e) { return {}; }
}
/* One timing source: lines of "<seconds> <name>", or a --record-times JSON file. */
function readTimingFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = {};
  if (/^\s*\{/.test(text)) {
    for (const r of JSON.parse(text).results || []) if (r && r.name && Number.isFinite(r.ms)) out[r.name] = Math.round(r.ms / 100) / 10;
    return out;
  }
  for (const l of text.split('\n')) { const m = /^\s*(\d+(?:\.\d+)?)\s+(\S+)\s*$/.exec(l); if (m) out[m[2]] = Number(m[1]); }
  return out;
}
function allGateNames() {
  const g = require('./gates.js');
  return [...g.TREE, ...g.EMU_GATES, ...g.LIVE_GATES].map((x) => x.name);
}
/* gate-times.json from timing files, kept to names that are gates today, sorted by name so a rebuild diffs. */
function buildTimes(files) {
  const known = new Set(allGateNames()), merged = {};
  for (const f of files) Object.assign(merged, readTimingFile(f));
  const seconds = {};
  for (const k of Object.keys(merged).sort()) if (known.has(k)) seconds[k] = merged[k];
  return { _about: 'Seconds per gate, for tools/gates.js --shard (longest first). Rebuild: node tools/shard.js --times-from=<files>. A gate missing here counts ' + UNKNOWN_S + ' s.',
    _source: files.map((f) => path.basename(f)).join(', '), seconds };
}

/* The flags that choose WHICH gates run: everything but the shard, where times go, and --list itself. */
const filterFlags = (args) => (args || []).filter((a) => !/^--(shard|record-times)=/.test(a) && a !== '--list').sort();

/* The floor under a tier's list. A filter that leaves 0 gates, with empty shard files, was COMPLETE; one that
   leaves 1 graded that one (28 Nov 2026 skeptic). Every real tier is far above it (37 emulator suites, 73
   Chrome-free, 175 tree), so a list under it is a filter gone wrong, never a tier. The CLI never lowers it. */
const MIN_EXPECTED = 20;
/* The aggregator. expected: the runner's own --list for `flags`. Returns the problems (none = complete). */
function complete({ dir, of, legs, flags, expected, min }) {
  const problems = [];
  const floor = min === undefined ? MIN_EXPECTED : min;
  if (!Array.isArray(expected) || expected.length < floor) problems.push('gates.js --list ' + filterFlags(flags).join(' ') + ' names only ' + (Array.isArray(expected) ? expected.length : 0) + ' gates, under the floor of ' + floor + ': a filter that leaves (almost) nothing proves nothing complete');
  if (legs !== undefined && legs !== 'success') problems.push('the matrix legs did not all succeed (needs.*.result = ' + legs + ')');
  if (!(Number.isInteger(of) && of >= 1)) return problems.concat(['--of=N is required (got ' + of + ')']);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (e) { problems.push('no results directory ' + dir + ': ' + e.message); }
  const byShard = new Map();
  for (const f of files) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { problems.push(f + ' is not readable JSON: ' + e.message); continue; }
    if (!/^\d+\/\d+$/.test(String(j.shard)) || Number(String(j.shard).split('/')[1]) !== of) { problems.push(f + ' is shard ' + j.shard + ', not one of ' + of); continue; }
    if (byShard.has(j.shard)) { problems.push('two results files for shard ' + j.shard); continue; }
    if (JSON.stringify(filterFlags(j.args)) !== JSON.stringify(filterFlags(flags))) problems.push(f + ' ran with flags ' + filterFlags(j.args).join(' ') + ', not ' + filterFlags(flags).join(' ') + ': its list is another list');
    byShard.set(j.shard, j);
  }
  for (let i = 1; i <= of; i++) if (!byShard.has(i + '/' + of)) problems.push('shard ' + i + '/' + of + ' left no results file: it was cancelled, refused or never started, so what it held is unknown');
  const seen = new Map();
  for (const [s, j] of byShard) for (const r of j.results || []) {
    if (!r.ok) problems.push(r.name + ' failed in shard ' + s);
    if (r.name === 'served-tree') continue;   // the runner's own after-the-last-gate check: only ever there when it failed
    if (seen.has(r.name)) problems.push(r.name + ' ran in shard ' + seen.get(r.name) + ' and again in shard ' + s);
    else seen.set(r.name, s);
  }
  if (byShard.size === of) {
    const want = new Set(expected);
    for (const n of expected) if (!seen.has(n)) problems.push(n + ' ran in no shard (gates.js --list ' + filterFlags(flags).join(' ') + ' names it)');
    for (const n of seen.keys()) if (!want.has(n)) problems.push(n + ' ran in shard ' + seen.get(n) + ' but gates.js --list does not name it');
  }
  return problems;
}
function cleanEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (k.startsWith('GIT_')) delete e[k]; return e; }
/* `node tools/gates.js --list <flags>`: { code, names, err }. */
function runnerList(flags, root) {
  const r = spawnSync(process.execPath, [path.join(root || ROOT, 'tools', 'gates.js'), '--list', ...flags], { cwd: root || ROOT, env: cleanEnv(), encoding: 'utf8', timeout: 120000 });
  return { code: r.status, names: String(r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean), err: String(r.stderr || '') };
}

/* ---------- self-test ---------- */
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : '')); } };
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-shard-'));
  try {
    /* 1. The partition's properties, for N = 1..12, on the real gate list with its real times and on lists
          built to be hard (all one time, all distinct, more bins than gates). */
    console.log('\n1. the partition: disjoint, complete, order-free, no idle shard, balanced\n');
    const real = allGateNames(), times = loadTimes();
    const same = Array.from({ length: 40 }, (_, k) => 'g' + String(k).padStart(2, '0'));
    const spread = Array.from({ length: 23 }, (_, k) => 'd' + k);
    const spreadT = Object.fromEntries(spread.map((x, k) => [x, (k * 37) % 101 + 1]));
    const cases = [['the real list', real, times], ['40 gates of one time', same, {}], ['23 distinct times', spread, spreadT], ['3 gates', ['a', 'b', 'c'], { a: 5 }]];
    /* A fixed shuffle (no Math.random: the self-test must give one answer). */
    const shuffle = (a, seed) => { const b = a.slice(); let s = seed; for (let k = b.length - 1; k > 0; k--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (k + 1); [b[k], b[j]] = [b[j], b[k]]; } return b; };
    const props = (S, names, tm, n) => {
      const bad = [];
      const t = (x) => (Object.prototype.hasOwnProperty.call(tm, x) ? tm[x] : UNKNOWN_S);
      let parts;
      try { parts = Array.from({ length: n }, (_, k) => S.shardOf(names, (k + 1) + '/' + n, tm)); } catch (e) { return ['threw: ' + e.message]; }
      const all = [].concat(...parts);
      if (new Set(all).size !== all.length) bad.push('disjoint');
      if (all.length !== names.length || !names.every((x) => all.includes(x))) bad.push('union');
      const again = Array.from({ length: n }, (_, k) => S.shardOf(shuffle(names, 7 + n), (k + 1) + '/' + n, tm).slice().sort());
      if (JSON.stringify(again) !== JSON.stringify(parts.map((p) => p.slice().sort()))) bad.push('order-free');
      if (names.length >= n && parts.some((p) => !p.length)) bad.push('no idle shard');
      const loads = parts.map((p) => p.reduce((s, x) => s + t(x), 0)), total = loads.reduce((a, b) => a + b, 0);
      if (Math.max(...loads) > total / n + Math.max(0, ...names.map(t)) + 1e-9) bad.push('balanced');
      parts.forEach((p) => { const idx = p.map((x) => names.indexOf(x)); if (idx.some((v, k) => k && v < idx[k - 1])) bad.push('list order'); });
      return bad;
    };
    const judge = (S) => { const out = []; for (const [label, names, tm] of cases) for (let n = 1; n <= 12; n++) { const b = props(S, names, tm, n); if (b.length) out.push(label + ' N=' + n + ': ' + b.join(', ')); } return out; };
    const real0 = judge({ shardOf });
    ok('every property holds for N = 1..12 on all four lists', real0.length === 0, real0);
    ok('names are unique across the tree, emulator and live lists (the union is by name)', new Set(real).size === real.length, real.filter((x, k) => real.indexOf(x) !== k));
    let threw = 0;
    for (const s of ['0/8', '9/8', '1/0', '0/0', 'a/8', '3', '', '1/8/2', '-1/8', '1.5/8', ' 1/8']) { try { parseShard(s); } catch (e) { threw++; } }
    ok('parseShard refuses 0/8, 9/8, 1/0, 0/0, a/8, 3, empty, 1/8/2, -1/8, 1.5/8 and " 1/8"', threw === 11, threw);

    /* 2. Mutants of the partition, each one line of impl(); each must turn a property red. */
    console.log('\n2. mutants of the partition, each must go red\n');
    const src = impl.toString();
    const mutant = (from, to) => { if (!src.includes(from)) throw new Error('mutant does not apply: ' + from); return new Function('return ' + src.replace(from, to))()(UNKNOWN_S); };
    const M = [
      ['shard i read 0-based (bin i, not i-1)', 'bins(names, n, times)[i - 1]', 'bins(names, n, times)[i]', /union/],
      ['the last bin never chosen (bin < n - 1)', 'bin < n; bin++', 'bin < n - 1; bin++', /no idle shard/],
      ['the tie-break by name dropped', 't(b) - t(a) || (a < b ? -1 : a > b ? 1 : 0)', 't(b) - t(a)', /order-free/],
      ['one gate dropped from every shard', 'for (const name of order)', 'for (const name of order.slice(1))', /union/],
      ['every gate into the first bin (the load never added)', 'load[best] += t(name);', ';', /no idle shard|balanced/],
    ];
    for (const [label, from, to, want] of M) {
      const p = judge(mutant(from, to));
      ok('mutant "' + label + '": red (' + want.source + ')', p.some((x) => want.test(x)), p.slice(0, 3));
    }
    let lax;
    try { lax = mutant("if (n < 1 || i < 1 || i > n)", "if (n < 1 || i > n)"); } catch (e) { lax = null; }
    let laxThrew = true; try { lax.parseShard('0/8'); laxThrew = false; } catch (e) {}
    ok('mutant "0 accepted as a shard": red (parseShard takes 0/8)', !!lax && !laxThrew);

    /* 3. The runner: --list, --shard and --browser-only through the real tools/gates.js. */
    console.log('\n3. tools/gates.js --list and --shard, the real runner\n');
    const L = (flags) => runnerList(flags);
    /* A runner that does not know --list RUNS its gates instead (a self-test against the old runner started a
       full suite for each listing, 28 Nov 2026). Asked first for a list of nothing: a runner that prints its
       banner there has no --list, and this section stops after one cheap, empty run. */
    try {
    const probe = L(['--only=__no_such_gate__']);
    if (probe.code !== 0 || probe.names.length) {
      ok('--list is understood (the runner printed a list, not a run: ' + JSON.stringify(probe.names.slice(0, 2)) + ')', false, probe.code);
      throw new Error('tools/gates.js has no --list; nothing else in section 3 is asked of it');
    }
    const full = L([]);
    ok('--list exits 0 and names gates, without starting the tree server', full.code === 0 && full.names.length > 50 && !/serving THIS tree/.test(full.err + full.names.join('\n')), full.code + ' ' + full.names.length + ' ' + full.err.slice(0, 300));
    const tree = require('./gates.js').TREE.filter((g) => !g.mutOnly).map((g) => g.name);
    ok('--list names every tree gate that is not mutation-only', tree.every((n) => full.names.includes(n)), tree.filter((n) => !full.names.includes(n)));
    for (const [flags, ns] of [[[], [1, 3, 8]], [['--no-browser'], [8]], [['--browser-only'], [8]], [['--emulator-only'], [4]]]) {
      const want = L(flags);
      for (const n of ns) {
        const parts = Array.from({ length: n }, (_, k) => L(flags.concat(['--shard=' + (k + 1) + '/' + n])));
        const all = [].concat(...parts.map((p) => p.names));
        ok('--list ' + flags.join(' ') + ' split ' + n + ' ways: every shard exits 0, each gate in exactly one, the union is the list (' + want.names.length + ' gates)',
          want.code === 0 && want.names.length > 0 && parts.every((p) => p.code === 0) && all.length === want.names.length && new Set(all).size === all.length && want.names.every((x) => all.includes(x)),
          { want: want.names.length, got: all.length, codes: parts.map((p) => p.code), missing: want.names.filter((x) => !all.includes(x)).slice(0, 5) });
      }
    }
    const nb = L(['--no-browser']).names, bo = L(['--browser-only']).names;
    ok('--browser-only and --no-browser split the list in two, with nothing in both and nothing in neither', nb.length && bo.length && !nb.some((x) => bo.includes(x)) && nb.length + bo.length === full.names.length && full.names.every((x) => nb.includes(x) || bo.includes(x)), { nb: nb.length, bo: bo.length, full: full.names.length });
    const badRuns = ['0/8', '9/8', '1/0', 'x', '1/8/2', ''].map((s) => L(['--shard=' + s]));
    ok('an invalid --shard exits 2 and names no gate (0/8, 9/8, 1/0, x, 1/8/2, empty)', badRuns.every((r) => r.code === 2 && r.names.length === 0), badRuns.map((r) => r.code + ':' + r.names.length));
    const both = L(['--no-browser', '--browser-only']);
    ok('--no-browser with --browser-only exits 2 (that list is empty by definition)', both.code === 2 && both.names.length === 0, both.code);
    /* A real run, not a listing: one fast gate, shard 1/1, its results recorded, then judged complete. */
    const rec = path.join(T, 'rec');
    fs.mkdirSync(rec);
    const runFlags = ['--no-browser', '--only=type-scale'];
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'gates.js'), ...runFlags, '--shard=1/1', '--record-times=' + path.join(rec, 'shard-1-of-1.json')], { cwd: ROOT, env: cleanEnv(), encoding: 'utf8', timeout: 300000 });
    let j = null; try { j = JSON.parse(fs.readFileSync(path.join(rec, 'shard-1-of-1.json'), 'utf8')); } catch (e) {}
    ok('--record-times writes the shard, the flags and each gate\'s verdict and time', r.status === 0 && j && j.shard === '1/1' && j.results.length === 1 && j.results[0].name === 'type-scale' && j.results[0].ok === true && Number.isFinite(j.results[0].ms), (r.status + ' ' + JSON.stringify(j) + ' ' + String(r.stdout).slice(-400)));
    /* min: 1 here only: one gate is far under the floor the CLI always applies, which the next line proves. */
    const p0 = complete({ dir: rec, of: 1, legs: 'success', flags: runFlags, expected: L(runFlags).names, min: 1 });
    ok('that recorded run is complete against the runner\'s own --list', p0.length === 0, p0);
    const p0f = complete({ dir: rec, of: 1, legs: 'success', flags: runFlags, expected: L(runFlags).names });
    ok('the same run at the default floor: red (one gate is not a tier)', p0f.some((x) => /under the floor/.test(x)), p0f);
    ok('timings read back from a results file, in seconds', j && readTimingFile(path.join(rec, 'shard-1-of-1.json'))['type-scale'] === Math.round(j.results[0].ms / 100) / 10);

    } catch (e) { ok('section 3 ran to its end', false, e && e.message || e); }

    /* 4. The aggregator, each way a run can be incomplete, staged. */
    console.log('\n4. the aggregator (tree-complete, emulator-complete): each incomplete run staged\n');
    /* 40: above the floor (MIN_EXPECTED), as every real tier is (37 emulator suites, 73 Chrome-free, 175 tree). */
    const names = Array.from({ length: 40 }, (_, k) => 'gate-' + k);
    const flags = ['--mutants'];
    let k = 0;
    const stage = (edit, list) => {
      const d = path.join(T, 'agg' + (k++)); fs.mkdirSync(d);
      for (let i = 1; i <= 4; i++) {
        const res = shardOf(list || names, i + '/4', {}).map((n) => ({ name: n, ok: true, ms: 1000 }));
        let file = { shard: i + '/4', args: flags.concat(['--shard=' + i + '/4', '--record-times=/x/s' + i + '.json']), results: res };
        file = edit ? edit(i, file) : file;
        if (file) fs.writeFileSync(path.join(d, 'shard-' + i + '-of-4.json'), JSON.stringify(file));
      }
      return d;
    };
    const run = (d, o) => complete(Object.assign({ dir: d, of: 4, legs: 'success', flags, expected: names }, o || {}));
    const holder = (n) => [1, 2, 3, 4].find((i) => shardOf(names, i + '/4', {}).includes(n));
    const S = [
      ['companion: four complete shards are complete', stage(), {}, null],
      ['a leg that failed (needs.tree.result = failure)', stage(), { legs: 'failure' }, /did not all succeed/],
      ['a leg that was cancelled (needs.tree.result = cancelled)', stage(), { legs: 'cancelled' }, /did not all succeed/],
      ['shard 3 left no results file', stage((i, f) => (i === 3 ? null : f)), {}, /shard 3\/4 left no results file/],
      ['gate-5 dropped from every shard', stage((i, f) => Object.assign(f, { results: f.results.filter((x) => x.name !== 'gate-5') })), {}, /gate-5 ran in no shard/],
      ['gate-5 ran twice', stage((i, f) => (i !== holder('gate-5') ? Object.assign(f, { results: f.results.concat([{ name: 'gate-5', ok: true, ms: 1 }]) }) : f)), {}, /gate-5 ran in shard .* and again/],
      ['gate-9 failed', stage((i, f) => Object.assign(f, { results: f.results.map((x) => (x.name === 'gate-9' ? { name: x.name, ok: false, ms: 1 } : x)) })), {}, /gate-9 failed/],
      ['the served-tree check failed in a shard', stage((i, f) => (i === 2 ? Object.assign(f, { results: f.results.concat([{ name: 'served-tree', ok: false, ms: 0 }]) }) : f)), {}, /served-tree failed/],
      ['a gate the list does not name', stage((i, f) => (i === 1 ? Object.assign(f, { results: f.results.concat([{ name: 'stranger', ok: true, ms: 1 }]) }) : f)), {}, /stranger ran in shard .* does not name it/],
      ['a shard run with other flags (--no-browser)', stage((i, f) => (i === 4 ? Object.assign(f, { args: f.args.concat(['--no-browser']) }) : f)), {}, /ran with flags/],
      ['a results file from an 8-way split', stage((i, f) => (i === 2 ? Object.assign(f, { shard: '2/8' }) : f)), {}, /is shard 2\/8, not one of 4/],
      ['no results at all', path.join(T, 'nothing-here'), {}, /no results directory|left no results file/],
      /* A filter that leaves nothing (or almost): every shard's file is there, empty or tiny, and each gate ran once.
         Before the floor this was COMPLETE (28 Nov 2026 skeptic). */
      ['a list of 0 gates, with four empty results files', stage(null, []), { expected: [] }, /names only 0 gates.*under the floor/],
      ['a list of 5 gates, each run once', stage(null, names.slice(0, 5)), { expected: names.slice(0, 5) }, /names only 5 gates.*under the floor/],
    ];
    for (const [label, d, o, want] of S) {
      const p = run(d, o);
      ok(want ? label + ': red' : label, want ? p.some((x) => want.test(x)) : p.length === 0, p);
    }

    /* 5. tools/gate-times.json: readable, every name a gate, every time a number. */
    console.log('\n5. tools/gate-times.json\n');
    let gt = null; try { gt = JSON.parse(fs.readFileSync(TIMES, 'utf8')); } catch (e) {}
    const known = new Set(real);
    ok('tools/gate-times.json parses and holds times', !!gt && gt.seconds && Object.keys(gt.seconds).length > 100, gt && Object.keys(gt.seconds || {}).length);
    ok('every name in it is a gate today, and every time is a number >= 0', !!gt && Object.entries(gt.seconds).every(([n, s]) => known.has(n) && Number.isFinite(s) && s >= 0), gt && Object.entries(gt.seconds).filter(([n, s]) => !known.has(n) || !(s >= 0)).slice(0, 5));
    const tf = path.join(T, 'times.txt');
    fs.writeFileSync(tf, '452.6 admin-ui\n  0.0 grid\nnot a line\n12 not-a-gate\n');
    const b = buildTimes([tf]);
    ok('a rebuild takes "<seconds> <name>" lines, keeps only gates, sorted', JSON.stringify(b.seconds) === JSON.stringify({ 'admin-ui': 452.6, grid: 0 }), b.seconds);
  } catch (e) { ok('the self-test ran to its end', false, e && e.stack || e); }
  finally { fs.rmSync(T, { recursive: true, force: true }); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  return fail;
}

if (require.main === module) {
  const ARGS = process.argv.slice(2);
  const dd = ARGS.indexOf('--');
  const own = dd >= 0 ? ARGS.slice(0, dd) : ARGS, rest = dd >= 0 ? ARGS.slice(dd + 1) : [];
  const val = (k) => { const a = own.find((x) => x.startsWith(k + '=')); return a === undefined ? undefined : a.slice(k.length + 1); };
  if (own.includes('--self-test')) { const f = selfTest(); console.log('SHARD: ' + (f ? 'FAIL' : 'PASS')); process.exit(f ? 1 : 0); }
  if (val('--times-from') !== undefined) {
    const files = val('--times-from').split(',').filter(Boolean).map((f) => path.resolve(f.replace(/^~(?=\/)/, os.homedir())));
    const b = buildTimes(files);
    fs.writeFileSync(TIMES, JSON.stringify(b, null, 2) + '\n');
    console.log('wrote ' + path.relative(ROOT, TIMES) + ': ' + Object.keys(b.seconds).length + ' gates from ' + b._source);
    process.exit(0);
  }
  if (val('--complete') !== undefined) {
    const of = Number(val('--of'));
    const list = runnerList(rest);
    if (list.code !== 0) { console.log('gates.js --list ' + rest.join(' ') + ' exited ' + list.code + ':\n' + list.err + '\nSHARDS: INCOMPLETE'); process.exit(1); }
    const p = complete({ dir: val('--complete'), of, legs: val('--legs'), flags: rest, expected: list.names });
    console.log('\n' + of + ' shards against gates.js --list ' + rest.join(' ') + ' (' + list.names.length + ' gates)\n');
    for (const x of p) console.log('  FAIL ' + x);
    if (!p.length) console.log('  ok   every shard left its results, every gate passed, and each of the ' + list.names.length + ' gates ran in exactly one shard');
    console.log('\nSHARDS: ' + (p.length ? 'INCOMPLETE' : 'COMPLETE'));
    process.exit(p.length ? 1 : 0);
  }
  console.log('usage: node tools/shard.js --self-test | --complete=<dir> --of=N [--legs=<result>] -- <gates.js flags> | --times-from=<files>');
  process.exit(64);
}
module.exports = { parseShard, bins, shardOf, loadTimes, readTimingFile, buildTimes, complete, runnerList, filterFlags, UNKNOWN_S, MIN_EXPECTED };
