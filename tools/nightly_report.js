#!/usr/bin/env node
/* Turns one night of tools/nightly.sh into a dated report, one line on the running bug board, and an
 * updated list of the findings still open.
 *
 *   node tools/nightly_report.js --dir=RUN_DIR --out=REPORTS_DIR --day=YYYY-MM-DD [--dry-run]
 *   node tools/nightly_report.js --replay-open --dir=RUN_DIR --out=REPORTS_DIR [--budget=SECONDS]
 *                                                 replay every open chaos finding's saved list (up to 3
 *                                                 times, stopping at the first that is not clean) into
 *                                                 RUN_DIR/replays.json; nightly.sh runs it before the report
 *   node tools/nightly_report.js --self-test      a night with a red gate, a new finding, an old one
 *                                                 and a fixed one, built in a temp dir and judged
 *
 * RUN_DIR is what nightly.sh leaves behind: gates.log + gates.exit, chaos/ fuzz-worker/ fuzz-rules/
 * (each tool's JSON report, written there by --out=), notes.log + notes.exit for the one watched test,
 * and timings.txt ("<step> <seconds> <exit>" per line). Nothing here runs a test; it only reads.
 *
 * WHERE THINGS GO. Everything is written under REPORTS_DIR (~/cubby-reports at night), never into the
 * repo: the repo is public and an open bug with its repro is not published before it is fixed.
 *   nightly-<day>.md        the night: what ran, every gate's verdict, every finding with its repro
 *   BOARD.md                one line per night: date, red/green, new findings, still-open findings by id
 *   known-findings.json     every finding ever seen, first and last night, and whether it is still open.
 *                           tools/fuzz_worker.js --self-test reads it, so a Worker finding that is already
 *                           on the board does not block a push, and a NEW one does.
 *
 * Verdict. RED when the suite itself failed (a gate in tools/gates.js), when a bug-bash tool could not
 * finish (exit 2: a harness that died finds nothing, and silence must not read as clean), or when a
 * finding is NEW tonight. A finding already on the board keeps its line on BOARD.md every night until it
 * stops reproducing, but does not turn the night red again or notify again. The last line printed is
 * "VERDICT red|green NEW n", which nightly.sh reads to decide whether to post a notification.
 *
 * FIXED MEANS REPLAYED CLEAN, for chaos. Chaos draws new sessions from the date every night and a 30-minute
 * box fits a handful, so "not hit tonight" says nothing about a race it did not happen to stage: three
 * nights of verifier seeds each found a different subset of the same bugs. So an open chaos finding is
 * marked fixed only when its own saved list replays CLEAN three times in a row (--replay-open, which writes
 * replays.json); not hit and not replayed, or replayed and still breaking anything, it stays open. The
 * fuzzers sweep every route and every rule each night, so for them "the tool finished and did not see it"
 * still means fixed.
 *
 * HARNESS ARTIFACTS (ARTIFACTS below) were reported by a harness that has since been corrected. On a ledger
 * they are closed as artifacts with the reason, never counted open; seen again by a later harness, the same
 * id is a finding like any other.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
/* id -> { reason, until: the last day the old harness could have reported it }. An id goes here only when
   its signature no longer comes back on the corrected harness, from ANY saved list, not just the one that
   showed the harness bug. Empty today: the two "timer stopped" ids of 14 Nov (CH-95c33b, CH-35ee67) were
   candidates and stay open, because a longer saved list still reproduces both on the corrected harness. */
const ARTIFACTS = {};
const arg = (k, d) => { const a = ARGS.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } };
const newest = (dir, re) => {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => re.test(n)); } catch (e) { return null; }
  names.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return names.length ? path.join(dir, names[0]) : null;
};
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');   // a pipe in a cell is escaped, not rewritten

/* One line per gate, in the shape tools/gates.js prints: "  <name>  ok|FAIL  12.3s  <gist>". */
function parseGates(log) {
  const out = [];
  for (const line of String(log || '').split('\n')) {
    const m = /^  (\S+)\s+(ok  |FAIL)\s+([\d.]+)s\s*(.*)$/.exec(line);
    if (m) out.push({ name: m[1], ok: m[2] === 'ok  ', secs: Number(m[3]), gist: m[4].trim() });
  }
  return out;
}

/* Every tool's findings in one shape: { id, tool, title, severity hint, repro }. */
function collect(dir) {
  const found = [], ran = {};
  const ch = readJson(newest(path.join(dir, 'chaos'), /^chaos-\d+\.json$/) || '');
  if (ch) {
    ran.chaos = ch.sessions + ' family sessions in ' + ch.minutes + ' min, seed ' + ch.seed;
    for (const f of ch.findings || []) {
      found.push({ id: f.id, tool: 'chaos', flaky: f.verdict !== 'real', verdict: f.verdict, title: f.inv + ': ' + f.detail,
        extra: f.verdict + ' (' + f.reproduced + ' re-runs), ' + f.shrunkTo, repro: f.repro });
    }
  }
  const fw = readJson(newest(path.join(dir, 'fuzz-worker'), /^fuzz-worker-\d+\.json$/) || '');
  if (fw) {
    ran.fuzzWorker = fw.requests + ' requests in ' + fw.seconds + ' s, seed ' + fw.seed;
    for (const f of fw.findings || []) found.push({ id: f.id, tool: 'fuzz-worker', flaky: false, title: f.inv + ' ' + f.route + ': ' + f.sig, extra: f.count + 'x', repro: f.repro });
  }
  const fr = readJson(newest(path.join(dir, 'fuzz-rules'), /^fuzz-rules-\d+\.json$/) || '');
  if (fr) {
    const real = (Array.isArray(fr) ? fr : []).find((r) => r.label === 'firestore.rules');
    if (real) {
      ran.fuzzRules = real.ops + ' ops (a full sweep is ' + real.sweep + '), seed ' + real.seed;
      for (const d of real.disagreements || []) found.push({ id: d.id, tool: 'fuzz-rules', flaky: false,
        title: d.op + ' as ' + d.actor + ': model says ' + (d.want ? 'allow' : 'deny') + ', rules ' + (d.got ? 'allowed' : 'denied'), extra: d.count + 'x', repro: d.repro });
    }
  }
  return { found, ran };
}

function timings(dir) {
  const t = {};
  for (const line of String(readText(path.join(dir, 'timings.txt')) || '').split('\n')) {
    const [step, secs, code] = line.trim().split(/\s+/);
    if (step) t[step] = { secs: Number(secs), code: Number(code) };
  }
  return t;
}

/* Replay every open chaos finding that tonight's hunt did not see, from its saved list. */
function replayOpen(dir, outDir, budgetS) {
  const known = readJson(path.join(outDir, 'known-findings.json')) || {};
  const tonight = new Set(collect(dir).found.map((f) => f.id));
  const cmd = process.env.NIGHTLY_REPLAY_CMD ? JSON.parse(process.env.NIGHTLY_REPLAY_CMD) : ['node', path.join(ROOT, 'tools', 'chaos.js')];
  const stop = Date.now() + budgetS * 1000;
  const res = {};
  for (const id of Object.keys(known).sort()) {
    const k = known[id];
    if (k.fixedOn || k.artifact || k.tool !== 'chaos' || tonight.has(id)) continue;
    const m = /--replay=(\S+)/.exec(k.repro || '');
    const file = m ? m[1] : null;
    if (!file || !fs.existsSync(file)) { res[id] = { file, runs: [], note: 'no saved list to replay' }; continue; }
    const runs = [];
    while (runs.length < 3 && Date.now() < stop) {
      const r = spawnSync(cmd[0], cmd.slice(1).concat(['--replay=' + file]), { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60000, maxBuffer: 64 * 1024 * 1024 });
      const lines = ((r.stdout || '') + (r.stderr || '')).match(/^REPLAY: (\w+)/gm) || [];
      runs.push(lines.length ? lines[lines.length - 1].slice(8) : 'ERROR exit ' + r.status);
      console.log('  replay ' + id + ' #' + runs.length + ': ' + runs[runs.length - 1]);
      if (runs[runs.length - 1] !== 'CLEAN') break;
    }
    res[id] = { file, runs, note: runs.length < 3 && runs.every((x) => x === 'CLEAN') ? 'ran out of time' : '' };
  }
  fs.writeFileSync(path.join(dir, 'replays.json'), JSON.stringify(res, null, 1));
  return res;
}
const cleanThrice = (rep) => !!(rep && rep.runs && rep.runs.length >= 3 && rep.runs.slice(0, 3).every((x) => x === 'CLEAN'));

function build(dir, outDir, day, dry) {
  const gatesLog = readText(path.join(dir, 'gates.log'));
  const gates = parseGates(gatesLog);
  const T = timings(dir);
  const gatesExit = T.gates ? T.gates.code : null;
  const { found, ran } = collect(dir);
  const knownFile = path.join(outDir, 'known-findings.json');
  const known = readJson(knownFile) || {};
  const replays = readJson(path.join(dir, 'replays.json')) || {};
  /* Close what an old harness reported, before anything below counts it open. */
  const artifactsNow = [];
  for (const [id, a] of Object.entries(ARTIFACTS)) {
    const k = known[id];
    if (k && !k.fixedOn && !k.artifact && (k.lastSeen || '') <= a.until) { k.artifact = a.reason; k.fixedOn = day; artifactsNow.push(id); }
  }
  const real = found.filter((f) => !f.flaky);
  const fresh = real.filter((f) => !known[f.id] || known[f.id].fixedOn);
  const stillOpen = real.filter((f) => known[f.id] && !known[f.id].fixedOn);
  const seenIds = new Set(real.map((f) => f.id));
  /* A finding that did not reproduce tonight is marked fixed only when the tool that found it ran to
     the end tonight; a crashed tool says nothing about what it did not reach. */
  /* Each tool exits 0 (clean) or 1 (findings) and writes its JSON report. Anything else (2: it threw;
     142: nightly.sh's watchdog killed it; 127: it was not there), or no report, is a tool that died. */
  const reportOf = { chaos: ran.chaos, 'fuzz-worker': ran.fuzzWorker, 'fuzz-rules': ran.fuzzRules };
  const toolOk = {};
  ['chaos', 'fuzz-worker', 'fuzz-rules'].forEach((k) => { toolOk[k] = !!(T[k] && (T[k].code === 0 || T[k].code === 1) && reportOf[k]); });
  /* Chaos: fixed only on three clean replays of its own list. The fuzzers: not seen by a run that finished. */
  const nowFixed = Object.keys(known).filter((id) => !known[id].fixedOn && !seenIds.has(id)
    && (known[id].tool === 'chaos' ? cleanThrice(replays[id]) : toolOk[known[id].tool]));
  const replayLine = (id) => { const r = replays[id]; if (!r) return 'not replayed tonight'; if (!r.runs.length) return r.note || 'not replayed';
    return r.runs.join(', ') + (cleanThrice(r) ? ': fixed' : r.runs[r.runs.length - 1] === 'CLEAN' ? ' (' + (r.note || 'fewer than three') + '): still open' : ': still open'); };
  const harnessDied = Object.keys(toolOk).filter((k) => !toolOk[k]);
  const failedGates = gates.filter((g) => !g.ok);
  const notes = T.notes ? (T.notes.code === 0 ? 'PASSES now: move tools/noteshome_test.js into tools/gates.js and drop its ALLOW entry' : 'still red (exit ' + T.notes.code + ')') : 'did not run';
  const red = gatesExit !== 0 || failedGates.length > 0 || harnessDied.length > 0 || fresh.length > 0;

  /* known-findings.json: every finding ever seen, by id. */
  for (const f of real) {
    const k = known[f.id] || (known[f.id] = { tool: f.tool, title: f.title, firstSeen: day });
    k.title = f.title; k.lastSeen = day; k.repro = f.repro; delete k.fixedOn; delete k.artifact;
  }
  nowFixed.forEach((id) => { known[id].fixedOn = day; });

  const md = ['# Cubby nightly bug-bash, ' + day + (dry ? ' (DRY RUN)' : ''), '',
    '**' + (red ? 'RED' : 'green') + '**: ' + (failedGates.length ? failedGates.length + ' gate(s) failed; ' : (gatesExit === 0 ? 'every gate passed; ' : 'gates exit ' + gatesExit + '; ')) +
      fresh.length + ' new finding(s), ' + stillOpen.length + ' still open, ' + nowFixed.length + ' no longer reproducing' + (harnessDied.length ? '; DID NOT FINISH: ' + harnessDied.join(', ') : '') + '.', '',
    '## What ran', '',
    '| step | seconds | exit | what |', '|---|---|---|---|',
    ...['gates', 'notes', 'chaos', 'fuzz-worker', 'fuzz-rules', 'replays'].map((k) => '| ' + k + ' | ' + (T[k] ? T[k].secs : '-') + ' | ' + (T[k] ? T[k].code : 'not run') + ' | ' + cell(
      k === 'gates' ? gates.length + ' gates (tools/gates.js ' + (dry ? 'a dry-run subset' : '--emulator') + ')' : k === 'notes' ? 'tools/noteshome_test.js, the one test excused from gates.js: ' + notes
        : k === 'replays' ? Object.keys(replays).length + ' open chaos finding(s) replayed from their saved lists (fixed only after three clean)'
        : k === 'chaos' ? ran.chaos || 'no report' : k === 'fuzz-worker' ? ran.fuzzWorker || 'no report' : ran.fuzzRules || 'no report') + ' |'), '',
    '## Findings', '',
    real.length || found.length ? '| id | new? | tool | what | detail | repro |\n|---|---|---|---|---|---|\n' + found.map((f) =>
      '| ' + f.id + ' | ' + (f.flaky ? (f.verdict || 'flaky') + ', not counted' : fresh.includes(f) ? '**NEW**' : 'open since ' + (known[f.id] && known[f.id].firstSeen)) + ' | ' + f.tool + ' | ' + cell(f.title).slice(0, 160) + ' | ' + cell(f.extra) + ' | `' + cell(f.repro) + '` |').join('\n') : 'Nothing found tonight.', '',
    nowFixed.length ? 'No longer reproducing (marked fixed tonight): ' + nowFixed.join(', ') + '\n' : '',
    Object.keys(replays).length ? '## Open chaos findings, replayed from their saved lists\n\nFixed only after three clean replays in a row.\n\n| id | replays |\n|---|---|\n' +
      Object.keys(replays).sort().map((id) => '| ' + id + ' | ' + cell(replayLine(id)) + ' |').join('\n') + '\n' : '',
    artifactsNow.length ? '## Closed as harness artifacts tonight\n\n' + artifactsNow.map((id) => '- ' + id + ': ' + ARTIFACTS[id].reason).join('\n') + '\n' : '',
    '## Gates', '',
    gates.length ? '| gate | verdict | seconds | gist |\n|---|---|---|---|\n' + gates.map((g) => '| ' + g.name + ' | ' + (g.ok ? 'ok' : '**FAIL**') + ' | ' + g.secs + ' | ' + cell(g.gist).slice(0, 120) + ' |').join('\n') : 'No gate lines in gates.log (did tools/gates.js start?).', '',
    'Full logs: ' + dir, ''];
  const reportFile = path.join(outDir, 'nightly-' + day + '.md');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(reportFile, md.join('\n'));

  const openIds = Object.keys(known).filter((id) => !known[id].fixedOn).sort();
  const boardFile = path.join(outDir, 'BOARD.md');
  if (!fs.existsSync(boardFile)) fs.writeFileSync(boardFile, '# Cubby bug board\n\nOne line per nightly run (tools/nightly.sh). Details and repro commands are in each nightly-<date>.md next to this file, never in the repo.\n\n| date | verdict | gates | new | still open | report |\n|---|---|---|---|---|---|\n');
  const board = '| ' + day + (dry ? ' (dry run)' : '') + ' | ' + (red ? 'RED' : 'green') + ' | ' + (gates.length - failedGates.length) + '/' + gates.length + (failedGates.length ? ' (failed: ' + failedGates.map((g) => g.name).join(', ') + ')' : '') +
    (harnessDied.length ? ', did not finish: ' + harnessDied.join(', ') : '') + ' | ' + (fresh.map((f) => f.id).join(', ') || '-') + ' | ' + (openIds.join(', ') || '-') + ' | nightly-' + day + '.md |\n';
  fs.appendFileSync(boardFile, board);
  fs.writeFileSync(knownFile, JSON.stringify(known, null, 1));
  return { red, fresh, stillOpen, nowFixed, failedGates, harnessDied, reportFile, boardFile, knownFile, board, artifactsNow };
}

function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); } };
  console.log('\nnightly report self-test: five nights in a temp dir');
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-nightly-report-'));
  const out = path.join(t, 'reports');
  const night = (name, o) => {
    const d = path.join(t, name);
    ['chaos', 'fuzz-worker', 'fuzz-rules'].forEach((x) => fs.mkdirSync(path.join(d, x), { recursive: true }));
    fs.writeFileSync(path.join(d, 'gates.log'), o.gates);
    fs.writeFileSync(path.join(d, 'timings.txt'), o.timings);
    fs.writeFileSync(path.join(d, 'chaos', 'chaos-7.json'), JSON.stringify({ seed: 7, minutes: 30, sessions: 40, findings: o.chaos }));
    fs.writeFileSync(path.join(d, 'fuzz-worker', 'fuzz-worker-7.json'), JSON.stringify({ seed: 7, seconds: 300, requests: 9, findings: o.fw }));
    fs.writeFileSync(path.join(d, 'fuzz-rules', 'fuzz-rules-7.json'), JSON.stringify([{ label: 'firestore.rules', seed: 7, ops: 10, sweep: 800, disagreements: o.fr }]));
    return d;
  };
  const okT = 'gates 60 0\nnotes 5 1\nchaos 1800 0\nfuzz-worker 300 1\nfuzz-rules 300 0\n';
  const fwA = { id: 'FW-I1-aaaaaa', inv: 'I1', route: 'POST /api/x', sig: 'throws', count: 3, repro: 'node tools/fuzz_worker.js --replay=a' };
  const chFlake = { id: 'CH-ffffff', inv: 'loader', detail: 'slow', verdict: 'flaky', reproduced: '1/3', shrunkTo: '9 of 9', repro: 'node tools/chaos.js --replay=f' };
  /* Night 1: one gate red, one Worker finding (new), one chaos flake. */
  let r = build(night('n1', { gates: '  rules             ok      4.0s  PASS\n  household-guard   FAIL    9.1s  FAIL owner\n', timings: okT.replace('gates 60 0', 'gates 60 1'), chaos: [chFlake], fw: [fwA], fr: [] }), out, '2026-11-14', false);
  ok('a failed gate makes the night RED and is named on the board', r.red && r.failedGates.length === 1 && /failed: household-guard/.test(r.board), r.board);
  ok('a first-seen finding is NEW', r.fresh.length === 1 && r.fresh[0].id === 'FW-I1-aaaaaa', r.fresh);
  ok('a chaos flake is reported but is not a finding on the board', !/CH-ffffff/.test(r.board) && /flaky/.test(fs.readFileSync(r.reportFile, 'utf8')), r.board);
  ok('the repro command is in the report', fs.readFileSync(r.reportFile, 'utf8').includes('node tools/fuzz_worker.js --replay=a'));
  ok('and the finding is on the known list fuzz_worker reads', Object.keys(readJson(r.knownFile)).includes('FW-I1-aaaaaa'));
  /* Night 2: gates green, the same Worker finding (still open, not new), a NEW rules disagreement. */
  const frB = { id: 'FR-bbbbbb', op: 'delete the household', actor: 'O', want: false, got: true, count: 1, repro: 'node tools/fuzz_rules.js --seed=7 --op=3' };
  r = build(night('n2', { gates: '  rules             ok      4.0s  PASS\n', timings: okT, chaos: [], fw: [fwA], fr: [frB] }), out, '2026-11-15', false);
  ok('a finding seen before is still open, not new', r.stillOpen.length === 1 && r.stillOpen[0].id === 'FW-I1-aaaaaa' && r.fresh.length === 1 && r.fresh[0].id === 'FR-bbbbbb', { fresh: r.fresh.map((f) => f.id), open: r.stillOpen.map((f) => f.id) });
  ok('a new finding alone makes the night RED', r.red === true);
  /* Night 3: everything green, nothing found: the Worker finding is marked fixed, the night is green. */
  r = build(night('n3', { gates: '  rules             ok      4.0s  PASS\n', timings: okT, chaos: [], fw: [], fr: [frB] }), out, '2026-11-16', false);
  ok('an old finding alone does not turn the night red again', r.red === false, r);
  ok('a finding that stopped reproducing is marked fixed', r.nowFixed.includes('FW-I1-aaaaaa') && readJson(r.knownFile)['FW-I1-aaaaaa'].fixedOn === '2026-11-16');
  /* Night 4: the chaos run died (exit 2): RED, and nothing is marked fixed on its say-so. */
  r = build(night('n4', { gates: '  rules             ok      4.0s  PASS\n', timings: okT.replace('fuzz-rules 300 0', 'fuzz-rules 3 2'), chaos: [], fw: [], fr: [] }), out, '2026-11-17', false);
  ok('a bug-bash tool that died makes the night RED', r.red && r.harnessDied.includes('fuzz-rules'), r.harnessDied);
  ok('and a finding it did not reach is NOT marked fixed', !r.nowFixed.includes('FR-bbbbbb'), r.nowFixed);
  /* Night 5: chaos exits 1 but wrote no report (the emulators never started): died, not clean. */
  const n5 = night('n5', { gates: '  rules             ok      4.0s  PASS\n', timings: okT.replace('chaos 1800 0', 'chaos 40 1'), chaos: [], fw: [], fr: [] });
  fs.unlinkSync(path.join(n5, 'chaos', 'chaos-7.json'));
  r = build(n5, out, '2026-11-18', false);
  ok('a tool that wrote no report counts as died, whatever its exit code', r.red && r.harnessDied.includes('chaos'), r.harnessDied);
  const board = fs.readFileSync(path.join(out, 'BOARD.md'), 'utf8').trim().split('\n').filter((l) => /^\| 2026/.test(l));
  ok('BOARD.md gained exactly one line per night', board.length === 5, board);

  /* Chaos findings: fixed only on three clean replays of their own saved list (NF-5, 14 Nov). Chaos draws new
     sessions every night, so a race it did not stage tonight is not fixed. A fresh ledger for these nights. */
  const out2 = path.join(t, 'reports2');
  const listFile = (name) => { const f = path.join(t, name + '.json'); fs.writeFileSync(f, '{"actions":[]}'); return f; };
  const chA = { id: 'CH-aaaaaa', inv: 'converge', detail: 'server is missing the raced medicine', verdict: 'real', reproduced: '3/3', shrunkTo: '7 of 30', repro: 'node tools/chaos.js --replay=' + listFile('a') };
  const chB = { id: 'CH-bbbbbb', inv: 'converge', detail: 'server is missing the reloaded entry', verdict: 'real', reproduced: '3/3', shrunkTo: '8 of 30', repro: 'node tools/chaos.js --replay=' + listFile('b') };
  const chC = { id: 'CH-cccccc', inv: 'converge', detail: 'a phone is missing a milestone', verdict: 'real', reproduced: '3/3', shrunkTo: '9 of 30', repro: 'node tools/chaos.js --replay=' + path.join(t, 'gone.json') };
  const quiet = '  rules             ok      4.0s  PASS\n';
  r = build(night('c1', { gates: quiet, timings: okT, chaos: [chA, chB, chC], fw: [], fr: [] }), out2, '2026-11-20', false);
  ok('three chaos findings open on their first night', r.fresh.length === 3, r.fresh.map((f) => f.id));
  /* Night 2: the hunt hit none of them, and nothing was replayed: all three stay OPEN. */
  r = build(night('c2', { gates: quiet, timings: okT, chaos: [], fw: [], fr: [] }), out2, '2026-11-21', false);
  ok('a chaos finding the hunt merely did not hit stays open (no replay, no "fixed")', r.nowFixed.length === 0 && Object.values(readJson(r.knownFile)).every((k) => !k.fixedOn), r.nowFixed);
  /* Night 3: replays. A three clean, B clean twice then reproduced, C has no saved list. The replayer is real
     (--replay-open); only the chaos command is a stub that answers from a script. */
  const c3 = night('c3', { gates: quiet, timings: okT, chaos: [], fw: [], fr: [] });
  const script = path.join(t, 'stub-answers.json');
  fs.writeFileSync(script, JSON.stringify({ a: ['CLEAN', 'CLEAN', 'CLEAN'], b: ['CLEAN', 'CLEAN', 'REPRODUCED'] }));
  const stub = path.join(t, 'stub-chaos.js');
  fs.writeFileSync(stub, "const fs=require('fs');const f=process.argv.find((a)=>a.startsWith('--replay=')).slice(9);const k=require('path').basename(f,'.json');" +
    "const s=JSON.parse(fs.readFileSync(" + JSON.stringify(script) + ",'utf8'));const n=" + JSON.stringify(path.join(t, 'stub-count-')) + "+k;let i=0;try{i=Number(fs.readFileSync(n,'utf8'))}catch(e){}" +
    "fs.writeFileSync(n,String(i+1));const v=s[k][i]||'CLEAN';console.log('REPLAY: '+v);process.exit(v==='CLEAN'?0:v==='REPRODUCED'?1:2);");
  const rp = spawnSync(process.execPath, [__filename, '--replay-open', '--dir=' + c3, '--out=' + out2, '--budget=60'], { encoding: 'utf8', env: Object.assign({}, process.env, { NIGHTLY_REPLAY_CMD: JSON.stringify([process.execPath, stub]) }) });
  const reps = readJson(path.join(c3, 'replays.json')) || {};
  ok('--replay-open replays each open chaos finding up to three times', rp.status === 0 && ((reps['CH-aaaaaa'] || {}).runs || []).join() === 'CLEAN,CLEAN,CLEAN', reps);
  ok('and stops at the first replay that is not clean', ((reps['CH-bbbbbb'] || {}).runs || []).join() === 'CLEAN,CLEAN,REPRODUCED', reps['CH-bbbbbb']);
  ok('and says so when there is no saved list to replay', ((reps['CH-cccccc'] || {}).runs || [1]).length === 0 && /no saved list/.test((reps['CH-cccccc'] || {}).note), reps['CH-cccccc']);
  r = build(c3, out2, '2026-11-22', false);
  const k3 = readJson(r.knownFile);
  ok('three clean replays in a row: marked fixed', r.nowFixed.includes('CH-aaaaaa') && k3['CH-aaaaaa'].fixedOn === '2026-11-22', r.nowFixed);
  ok('two clean and then reproduced: still open', !r.nowFixed.includes('CH-bbbbbb') && !k3['CH-bbbbbb'].fixedOn, k3['CH-bbbbbb']);
  ok('no list to replay: still open', !k3['CH-cccccc'].fixedOn, k3['CH-cccccc']);
  ok('and the report shows every replay', /CH-bbbbbb \| CLEAN, CLEAN, REPRODUCED: still open/.test(fs.readFileSync(r.reportFile, 'utf8')), fs.readFileSync(r.reportFile, 'utf8').split('\n').filter((l) => /CH-/.test(l)));
  /* Harness artifacts: an id an old chaos reported (planted into ARTIFACTS for this test) is closed with its
     reason, and reopened when the corrected harness sees it again. */
  ARTIFACTS['CH-zzzzzz'] = { until: '2026-11-14', reason: 'harness artifact: planted by the self-test' };
  const out3 = path.join(t, 'reports3');
  const tm = { id: 'CH-zzzzzz', inv: 'converge', detail: 'server has the sleep timer stopped', verdict: 'real', reproduced: '3/3', shrunkTo: '5 of 30', repro: 'node tools/chaos.js --replay=' + listFile('tm') };
  build(night('a1', { gates: quiet, timings: okT, chaos: [tm], fw: [], fr: [] }), out3, '2026-11-13', false);
  r = build(night('a2', { gates: quiet, timings: okT, chaos: [], fw: [], fr: [] }), out3, '2026-11-15', false);
  const ka = readJson(r.knownFile)['CH-zzzzzz'];
  ok('an id an old harness reported is closed as a harness artifact, with the reason', r.artifactsNow.includes('CH-zzzzzz') && /harness artifact/.test(ka.artifact) && !/CH-zzzzzz/.test(r.board.split('|')[5] || ''), ka);
  r = build(night('a3', { gates: quiet, timings: okT, chaos: [tm], fw: [], fr: [] }), out3, '2026-11-16', false);
  ok('and seen again by the corrected harness it is a finding again (NEW)', r.fresh.some((f) => f.id === 'CH-zzzzzz'), r.fresh.map((f) => f.id));
  delete ARTIFACTS['CH-zzzzzz'];
  /* The two "timer stopped" ids stay open: a ledger that holds them does not close them. */
  const out4 = path.join(t, 'reports4');
  const t1 = Object.assign({}, tm, { id: 'CH-95c33b' }), t2 = Object.assign({}, tm, { id: 'CH-35ee67', detail: 'a phone shows the sleep timer stopped' });
  build(night('a4', { gates: quiet, timings: okT, chaos: [t1, t2], fw: [], fr: [] }), out4, '2026-11-14', false);
  r = build(night('a5', { gates: quiet, timings: okT, chaos: [], fw: [], fr: [] }), out4, '2026-11-15', false);
  const k4 = readJson(r.knownFile);
  ok('the "timer stopped" ids are not closed as artifacts (they still reproduce on the corrected harness)', !r.artifactsNow.length && !k4['CH-95c33b'].fixedOn && !k4['CH-35ee67'].fixedOn, k4);
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  console.log('NIGHTLY-REPORT SELF-TEST: ' + (fail ? 'FAIL' : 'PASS'));
  return fail;
}

if (require.main === module) {
  if (ARGS.includes('--self-test')) process.exit(selfTest() ? 1 : 0);
  const dir = arg('dir', null), out = arg('out', null), day = arg('day', new Date().toISOString().slice(0, 10));
  if (ARGS.includes('--replay-open')) {
    if (!dir || !out) { console.error('usage: node tools/nightly_report.js --replay-open --dir=RUN_DIR --out=REPORTS_DIR [--budget=SECONDS]'); process.exit(2); }
    const res = replayOpen(dir, out, Number(arg('budget', 1800)));
    console.log('replayed ' + Object.keys(res).length + ' open chaos finding(s): ' + Object.keys(res).map((id) => id + ' ' + (res[id].runs.join('/') || res[id].note)).join('; '));
    process.exit(0);
  }
  if (!dir || !out) { console.error('usage: node tools/nightly_report.js --dir=RUN_DIR --out=REPORTS_DIR [--day=YYYY-MM-DD] [--dry-run] | --self-test'); process.exit(2); }
  const r = build(dir, out, day, ARGS.includes('--dry-run'));
  console.log('report: ' + r.reportFile);
  console.log('board:  ' + r.boardFile);
  console.log(r.board.trim());
  console.log('VERDICT ' + (r.red ? 'red' : 'green') + ' NEW ' + r.fresh.length);
}
module.exports = { build, parseGates, collect, replayOpen };
