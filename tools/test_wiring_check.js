#!/usr/bin/env node
/* Is every test actually run? A test not wired into tools/gates.js does not exist.
 *
 *   node tools/test_wiring_check.js              judge this checkout
 *   node tools/test_wiring_check.js --self-test  first plant an unwired test (and four other lies) in a
 *                                                throwaway tree and prove each one is caught, then judge
 *
 * WHY. In November 2026 five incident tests were found orphaned, one of them red, until someone looked.
 * Before that, 22 of 24 gates ran nowhere. A test file is budgeted for as protection the day it lands,
 * and nothing reports it when no runner ever calls it again. So this is asked from the runner's side:
 * every file that LOOKS like a test must be named in a gates.js command, or sit in ALLOW below with a
 * one-line reason. A reason that says another file runs it ("ranBy") is checked, not trusted.
 *
 * What counts as a test (CANDIDATES): test/*.js (every top-level file there is a runnable suite), and
 * tools/*_check.js, tools/*_gate.js, tools/*_test.js.
 *
 * What counts as wired: the path appears as a string literal in a gates.js command ('tools/x_check.js',
 * 'test/x.test.js') or as an emulator command ('node x.test.js', run from test/). Comments are stripped
 * first, so a gate that is merely MENTIONED in a comment is still an orphan (that is the trap: the xss
 * leaf check is named in a comment AND wired, and only the second one counts).
 *
 * Also red: gates.js naming a file that does not exist (a gate that can never run), an ALLOW entry for a
 * file that is gone or that is now wired (a stale excuse), and a ranBy file that does not mention it.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* Files that look like tests but are deliberately not in gates.js. Each needs a reason a stranger can
   check. ranBy: a file that must mention this one (CI workflow, runbook, or the gate that runs it). */
const ALLOW = {
  'tools/signin_gate.js': { reason: 'production only: the CI live job runs it against little-cubby.com after every push to main',
    ranBy: '.github/workflows/gates.yml' },
  'tools/signin_live_check.js': { reason: 'production only and needs tools/serviceAccountKey.json: the post-deploy list in OPERATIONS.md',
    ranBy: 'OPERATIONS.md' },
  'tools/android_parity_check.js': { reason: 'red by design until the Android wrapper lands (6 of 13 fail, 31 Aug plan): "wire it in on the day it first passes"',
    ranBy: 'OPERATIONS.md' },
  'tools/push_send_test.js': { reason: 'sends a REAL push to every registered phone with the service account; manual, never automatic' },
  'tools/noteshome_test.js': { reason: 'RED for a real reason (quote of the day 14px = its heading since 552f36fb\'s type scale); a product fix, not this lane\'s. Watched nightly until it passes, then move it into gates.js',
    ranBy: 'tools/nightly.sh' },
};

const CANDIDATE_RES = [/^test\/[^/]+\.js$/, /^tools\/[^/]+_check\.js$/, /^tools\/[^/]+_gate\.js$/, /^tools\/[^/]+_test\.js$/];

function listCandidates(root) {
  const out = [];
  for (const dir of ['test', 'tools']) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, dir)); } catch (e) { names = []; }
    for (const n of names) {
      const rel = dir + '/' + n;
      if (!CANDIDATE_RES.some((re) => re.test(rel))) continue;
      try { if (!fs.statSync(path.join(root, rel)).isFile()) continue; } catch (e) { continue; }
      out.push(rel);
    }
  }
  return out.sort();
}

/* Block and line comments out, string literals kept. A tiny scanner rather than a regex, because a URL
   inside a string ('https://...') looks exactly like a line comment to a regex. */
function stripComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += d || ''; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === '\'' || c === '"' || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    out += c; i++;
  }
  return out;
}

function wiredSet(gatesSrc) {
  const code = stripComments(gatesSrc);
  const lits = [];
  const re = /'([^'\\\n]*)'|"([^"\\\n]*)"/g;
  let m;
  while ((m = re.exec(code))) lits.push(m[1] !== undefined ? m[1] : m[2]);
  const wired = new Set();
  for (const s of lits) {
    if (/^(tools|test)\/[^\s]+\.js$/.test(s)) wired.add(s);
    const emu = /^node\s+([^\s/]+\.js)(\s|$)/.exec(s);   // EMU_GATES run from test/
    if (emu) wired.add('test/' + emu[1]);
  }
  return wired;
}

function check(root, allow, log) {
  const fails = [];
  const bad = (m) => { fails.push(m); if (log) console.log('  FAIL ' + m); };
  const good = (m) => { if (log) console.log('  ok   ' + m); };
  const gatesPath = path.join(root, 'tools', 'gates.js');
  let src = '';
  try { src = fs.readFileSync(gatesPath, 'utf8'); } catch (e) { bad('tools/gates.js is missing'); return fails; }
  const wired = wiredSet(src);
  const cands = listCandidates(root);
  let nWired = 0, nAllowed = 0;
  for (const c of cands) {
    if (wired.has(c)) {
      nWired++;
      if (allow[c]) bad(c + ' is wired into gates.js AND excused in ALLOW: drop the stale excuse');
      continue;
    }
    const a = allow[c];
    if (!a) { bad(c + ' is run by nothing: wire it into tools/gates.js, or add it to ALLOW in tools/test_wiring_check.js with a reason'); continue; }
    if (!a.reason || a.reason.length < 12) { bad(c + ' is excused without a real reason'); continue; }
    if (a.ranBy) {
      let by = '';
      try { by = fs.readFileSync(path.join(root, a.ranBy), 'utf8'); } catch (e) { by = null; }
      if (by === null) { bad(c + ': ALLOW says ' + a.ranBy + ' runs it, and that file does not exist'); continue; }
      if (by.indexOf(path.basename(c)) < 0) { bad(c + ': ALLOW says ' + a.ranBy + ' runs it, and it never names ' + path.basename(c)); continue; }
    }
    nAllowed++;
  }
  for (const a of Object.keys(allow)) if (!cands.includes(a)) bad('ALLOW names ' + a + ', which is not a test file in this tree any more');
  for (const w of wired) if (!fs.existsSync(path.join(root, w))) bad('gates.js runs ' + w + ', which does not exist, so that gate can never pass');
  if (!fails.length) good(cands.length + ' test files: ' + nWired + ' wired into gates.js, ' + nAllowed + ' excused with a checked reason');
  return fails;
}

function selfTest() {
  console.log('\nself-test: plant each lie in a throwaway tree and watch it go red');
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '  ' + JSON.stringify(x).slice(0, 300) : '')); } };
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-wiring-'));
  fs.mkdirSync(path.join(t, 'tools')); fs.mkdirSync(path.join(t, 'test'));
  const w = (p, s) => fs.writeFileSync(path.join(t, p), s);
  const gates = (body) => w('tools/gates.js', "const TREE = [\n" + body + "\n];\n/* tools/ghost_check.js is only mentioned here */\n// 'tools/ghost_check.js' in a line comment\nconst U = 'https://x.test/a';\n");
  w('tools/a_check.js', ''); w('test/b.test.js', ''); w('test/c.test.js', ''); w('tools/helper.js', '');
  gates("{ name: 'a', cmd: ['node', 'tools/a_check.js', 'url'] },\n{ name: 'b', cmd: ['node', 'test/b.test.js'] },\n{ name: 'c', emu: 'node c.test.js' },");
  let f = check(t, {}, false);
  ok('a fully wired tree is green (cmd, test/ cmd and emu forms all count; helpers are not tests)', f.length === 0, f);

  w('test/new-incident.test.js', '');
  f = check(t, {}, false);
  ok('a planted unwired test is caught by name', f.length === 1 && /test\/new-incident\.test\.js is run by nothing/.test(f[0]), f);

  w('tools/ghost_check.js', '');
  f = check(t, {}, false);
  ok('a gate only MENTIONED in comments is still an orphan', f.some((x) => /tools\/ghost_check\.js is run by nothing/.test(x)), f);

  f = check(t, { 'test/new-incident.test.js': { reason: 'one-off probe kept for the postmortem' }, 'tools/ghost_check.js': { reason: 'run from the runbook by hand', ranBy: 'tools/a_check.js' } }, false);
  ok('a ranBy that does not mention the file is caught', f.length === 1 && /ghost_check\.js: ALLOW says tools\/a_check\.js runs it, and it never names/.test(f[0]), f);

  f = check(t, { 'test/new-incident.test.js': { reason: 'one-off probe kept for the postmortem' }, 'tools/ghost_check.js': { reason: 'x' } }, false);
  ok('an excuse without a reason is caught', f.some((x) => /ghost_check\.js is excused without a real reason/.test(x)), f);

  f = check(t, { 'test/new-incident.test.js': { reason: 'one-off probe kept for the postmortem' }, 'tools/ghost_check.js': { reason: 'run from the runbook by hand' }, 'test/b.test.js': { reason: 'stale excuse for a wired one' }, 'tools/gone_check.js': { reason: 'excuse for a deleted file' } }, false);
  ok('an excuse for a WIRED test is caught as stale', f.some((x) => /test\/b\.test\.js is wired into gates\.js AND excused/.test(x)), f);
  ok('an excuse for a file that is gone is caught', f.some((x) => /ALLOW names tools\/gone_check\.js/.test(x)), f);

  gates("{ name: 'a', cmd: ['node', 'tools/a_check.js', 'url'] },\n{ name: 'b', cmd: ['node', 'test/b.test.js'] },\n{ name: 'c', emu: 'node c.test.js' },\n{ name: 'd', cmd: ['node', 'test/deleted.test.js'] },");
  f = check(t, { 'test/new-incident.test.js': { reason: 'one-off probe kept for the postmortem' }, 'tools/ghost_check.js': { reason: 'run from the runbook by hand' } }, false);
  ok('gates.js naming a file that does not exist is caught', f.length === 1 && /gates\.js runs test\/deleted\.test\.js, which does not exist/.test(f[0]), f);

  /* And the real ALLOW list against the real tree: every ranBy here is a claim about another file. */
  ok('stripComments keeps a URL inside a string', stripComments("const u = 'https://a.b/c'; // gone\n").indexOf('https://a.b/c') >= 0);
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  return fail;
}

if (require.main === module) {
  let failed = 0;
  if (process.argv.includes('--self-test')) failed += selfTest();
  console.log('\ntest wiring: every test file is run by tools/gates.js, or excused with a checked reason\n');
  const f = check(ROOT, ALLOW, true);
  failed += f.length;
  console.log('\nTEST-WIRING: ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);
}
module.exports = { check, wiredSet, listCandidates, stripComments, ALLOW };
