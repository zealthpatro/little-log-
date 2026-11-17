#!/usr/bin/env node
/* A push that changes product code must also change a test or a gate, or say in writing why not.
 *
 *   node tools/change_test_check.js <base>..<head>     judge a range by hand
 *   node tools/change_test_check.js --stdin            what .githooks/pre-push runs: git's own stdin
 *                                                      ("<local ref> <local sha> <remote ref> <remote sha>")
 *   node tools/change_test_check.js --stdin --tier     print "emulator" or "tree": which gate tier the
 *                                                      pushed range needs (the hook reads this)
 *   node tools/change_test_check.js --self-test        prove it red and green in a throwaway repo
 *
 * WHY. A push to main is a deploy here, and every P0 this year shipped in a change that touched no test:
 * the solo-parent write loss, the four days of 502 on code sign-in, the invite that ate a field. The
 * gates only protect what someone wrote a gate for, so the cheapest moment to ask "what proves this?"
 * is the push that changes the code. This does not judge the test; red-then-green is still on the
 * author. It only refuses the silent case.
 *
 * Product code: app/**.js, app/**.html, worker.js, workers/**, firestore.rules, storage.rules.
 * Counts as a test: test/**, tools/*check*, tools/*gate* (gates.js included), tools/*_test.js,
 * tools/chaos*.js, tools/fuzz_*.js.
 * The escape hatch is a commit trailer in the range, printed on every push so it stays honest:
 *     Test-exempt: copy-only change to the privacy page, no behaviour
 *
 * A new branch (remote sha all zeros) is judged from its merge-base with origin/main. A deleted ref is
 * skipped. A range git cannot resolve fails closed, with the reason.
 *
 * The tier: the Firestore emulator suites run before a push whenever it touches the rules, the Worker or
 * its config (wrangler.toml) and usage D1 schema (schema/usage.sql), the client's Firestore layer, the
 * emulator runner (tools/gates.js) or any file an emulator gate runs (EMU_TRIGGERS, plus the suites
 * tools/gates.js names). Everything else runs the tree tier, which is what pre-push always ran.
 */
'use strict';
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ZERO = /^0+$/;
const PRODUCT = [/^app\/.+\.(js|html)$/, /^worker\.js$/, /^workers\//, /^firestore\.rules$/, /^storage\.rules$/];
const TESTISH = [/^test\//, /^tools\/[^/]*check[^/]*$/, /^tools\/[^/]*gate[^/]*$/, /^tools\/[^/]*_test\.js$/,
  /^tools\/chaos[^/]*\.js$/, /^tools\/fuzz_[^/]*\.js$/];
const EMU_TRIGGERS = [/^firestore\.rules$/, /^storage\.rules$/, /^worker\.js$/, /^workers\//, /^app\/store-firebase\.js$/,
  /^wrangler\.toml$/, /^schema\/usage\.sql$/,   // the Worker's config and its usage D1 schema: usage-d1 judges both
  /^test\/[^/]*emu[^/]*$/, /^test\/[^/]*rules[^/]*$/,
  /^tools\/gates\.js$/, /^firebase\.json$/, /^test\/package(-lock)?\.json$/];   // the emulator runner and its toolchain

/* Every file an emulator gate runs is a trigger too, read from tools/gates.js itself, so a push that edits
   test/circle-manage.test.js or tools/chaos.js runs the tier that runs it, whatever the file is called.
   An `emu:` command runs from test/ ("node x.test.js"); a `self:` command names its path. */
function emuSuiteFiles(cwd) {
  let src = '';
  try { src = fs.readFileSync(path.join(cwd, 'tools', 'gates.js'), 'utf8'); } catch (e) { return []; }
  const out = new Set();
  for (const m of src.matchAll(/\bemu:\s*'node\s+([^'\s]+\.js)/g)) out.add('test/' + m[1]);
  for (const m of src.matchAll(/\bself:\s*\[([^\]]*)\]/g)) for (const q of m[1].matchAll(/'((?:tools|test)\/[^']+\.js)'/g)) out.add(q[1]);
  return [...out];
}
const EXEMPT = /^Test-exempt:[ \t]*(\S.*)$/mi;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function tryGit(cwd, args) { try { return git(cwd, args); } catch (e) { return null; } }

/* Turn git's pre-push stdin into concrete base..head ranges. */
function rangesFromStdin(cwd, text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    const [localRef, localSha, remoteRef, remoteSha] = p;
    if (ZERO.test(localSha)) continue;                         // deleting a remote ref: nothing to judge
    let base = null, why = '';
    if (!ZERO.test(remoteSha) && tryGit(cwd, ['cat-file', '-e', remoteSha + '^{commit}']) !== null) {
      base = remoteSha; why = remoteRef + ' was at ' + remoteSha.slice(0, 8);
    } else {
      for (const ref of ['origin/main', 'refs/remotes/origin/main', 'main']) {
        const mb = tryGit(cwd, ['merge-base', localSha, ref]);
        if (mb) { base = mb; why = 'new to ' + remoteRef + ', judged from its merge-base with ' + ref; break; }
      }
    }
    out.push({ localRef, remoteRef, base, head: localSha, why });
  }
  return out;
}

function judge(cwd, ranges) {
  const report = { files: [], product: [], tests: [], exempt: [], errors: [], ranges: [] };
  const seen = new Set();
  for (const r of ranges) {
    if (!r.base) { report.errors.push('cannot find a base for ' + r.localRef + ' (' + r.head.slice(0, 8) + '): fetch origin, or push with --no-verify and say why'); continue; }
    const files = tryGit(cwd, ['diff', '--name-only', '--no-renames', r.base, r.head]);
    if (files === null) { report.errors.push('git cannot diff ' + r.base.slice(0, 8) + '..' + r.head.slice(0, 8)); continue; }
    report.ranges.push(r.base.slice(0, 8) + '..' + r.head.slice(0, 8) + ' (' + r.why + ')');
    for (const f of files.split('\n').filter(Boolean)) if (!seen.has(f)) { seen.add(f); report.files.push(f); }
    const log = tryGit(cwd, ['log', '--format=%h%x00%B%x01', r.base + '..' + r.head]) || '';
    for (const entry of log.split('\x01')) {
      const [sha, body] = entry.split('\x00');
      if (!body) continue;
      const m = EXEMPT.exec(body);
      if (m) report.exempt.push(sha.trim() + ': ' + m[1].trim());
    }
  }
  report.product = report.files.filter((f) => PRODUCT.some((re) => re.test(f)));
  report.tests = report.files.filter((f) => TESTISH.some((re) => re.test(f)));
  const suites = emuSuiteFiles(cwd);
  report.tier = report.files.some((f) => EMU_TRIGGERS.some((re) => re.test(f)) || suites.includes(f)) ? 'emulator' : 'tree';
  report.ok = !report.errors.length && (!report.product.length || report.tests.length > 0 || report.exempt.length > 0);
  return report;
}

function print(rep) {
  const L = (s) => console.log(s);
  L('\nchange needs test: ' + (rep.ranges.join(', ') || 'nothing to push'));
  rep.errors.forEach((e) => L('  FAIL ' + e));
  if (!rep.product.length) L('  ok   no product code in this push (' + rep.files.length + ' files)');
  else if (rep.tests.length) L('  ok   ' + rep.product.length + ' product file(s) changed, with ' + rep.tests.length + ' test/gate file(s): ' + rep.tests.slice(0, 4).join(', ') + (rep.tests.length > 4 ? ', ...' : ''));
  else if (rep.exempt.length) { L('  ok   product code changed with no test, exempted in writing:'); rep.exempt.forEach((e) => L('         Test-exempt ' + e)); }
  else {
    L('  FAIL product code changed and no test or gate did:');
    rep.product.slice(0, 12).forEach((f) => L('         ' + f));
    L('       Add or extend the test that proves it (test/**, tools/*_check.js, a gate in tools/gates.js),');
    L('       or put a trailer on one commit saying why none is needed:   Test-exempt: <reason>');
  }
  if (rep.exempt.length && rep.tests.length) rep.exempt.forEach((e) => L('  note Test-exempt ' + e));
  L('CHANGE-TEST: ' + (rep.ok ? 'PASS' : 'FAIL'));
}

/* A throwaway repo: code-only push is red, code+test is green, a Test-exempt trailer is green, and
   the tier follows the files. Nothing outside os.tmpdir() is touched. */
function selfTest() {
  /* Before any git: inside a hook (this runs as a pre-push gate) git exports GIT_DIR, and from a linked
     worktree it names the SHARED repository. Inherited, the `git init/config/commit/reset` below rewrote that
     repository (core.bare, core.hooksPath, user.email, branch heads) instead of this temp one. tools/gates.js
     scrubs it for every gate; this scrubs it again so the self-test is safe however it is started. The CLI
     runs below inherit the scrubbed env too. test/prepush-worktree.test.js runs this inside a real worktree push. */
  for (const k of Object.keys(process.env)) if (/^GIT_/.test(k)) delete process.env[k];
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); } };
  console.log('\nself-test: a throwaway repo with an origin, pushed range by range');
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-change-test-'));
  const g = (...a) => git(t, a);
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'selftest@example.test'); g('config', 'user.name', 'self test');
  g('config', 'commit.gpgsign', 'false'); g('config', 'core.hooksPath', '/dev/null');
  const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(t, p)), { recursive: true }); fs.writeFileSync(path.join(t, p), s); };
  const commit = (msg) => { g('add', '-A'); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
  w('README.md', 'x\n'); w('app/index.html', '<p>1</p>\n'); w('test/a.test.js', '1\n');
  const root = commit('root');
  g('update-ref', 'refs/remotes/origin/main', root);
  const stdin = (head, remote) => 'refs/heads/main ' + head + ' refs/heads/main ' + (remote || root) + '\n';
  const run = (head, remote) => judge(t, rangesFromStdin(t, stdin(head, remote)));

  w('app/index.html', '<p>2</p>\n'); const codeOnly = commit('change the app');
  let r = run(codeOnly);
  ok('a code-only push is RED', r.ok === false && r.product.includes('app/index.html'), r);
  ok('and its tier is tree (no rules, no Worker)', r.tier === 'tree', r.tier);

  w('test/a.test.js', '2\n'); const withTest = commit('and prove it');
  r = run(withTest);
  ok('code + test in the same push is GREEN', r.ok === true && r.tests.includes('test/a.test.js'), r);

  g('reset', '-q', '--hard', codeOnly);
  w('app/index.html', '<p>3</p>\n'); g('add', '-A');
  g('commit', '-q', '-m', 'copy tweak\n\nTest-exempt: words only, nothing a test could see');
  r = run(g('rev-parse', 'HEAD'));
  ok('a Test-exempt trailer is GREEN', r.ok === true && r.exempt.length === 1, r);
  ok('and the reason is reported', /words only, nothing a test could see/.test(r.exempt[0] || ''), r.exempt);

  g('reset', '-q', '--hard', root);
  w('docs/x.md', 'y\n'); const docs = commit('docs');
  r = run(docs);
  ok('a docs-only push is GREEN and runs the tree tier', r.ok === true && r.tier === 'tree', r);

  w('firestore.rules', 'rules\n'); w('test/rules-test.js', 'x\n'); const rules = commit('rules + test');
  r = run(rules);
  ok('a rules push asks for the emulator tier', r.ok === true && r.tier === 'emulator', r);

  /* A suite the emulator tier runs, named by tools/gates.js, triggers that tier whatever it is called. */
  w('tools/gates.js', "const EMU_GATES = [\n  { name: 'hg', emu: 'node household-guard.test.js' },\n  { name: 'cm', self: ['node', 'test/circle-manage.test.js'] },\n];\n");
  const gatesOnly = commit('the runner names two emulator suites');
  r = judge(t, rangesFromStdin(t, stdin(gatesOnly, rules)));   // this commit alone
  ok('a push that edits tools/gates.js runs the emulator tier (it is the emulator runner)', r.tier === 'emulator', r.tier);
  w('test/circle-manage.test.js', 'y\n'); const cm = commit('a self-hosting emulator suite');
  r = judge(t, rangesFromStdin(t, stdin(cm, gatesOnly)));
  ok('a push that edits a self-hosting emulator suite (named only in gates.js) runs the emulator tier', r.tier === 'emulator', r);
  w('test/household-guard.test.js', 'z\n'); const hg = commit('an emulator suite run from test/');
  r = judge(t, rangesFromStdin(t, stdin(hg, cm)));
  ok('and so does one gates.js runs as an `emu:` command from test/', r.tier === 'emulator', r);
  w('test/a.test.js', '3\n'); const plainTest = commit('a tree test');
  r = judge(t, rangesFromStdin(t, stdin(plainTest, hg)));
  ok('while a plain tree test stays on the tree tier', r.tier === 'tree', r);
  /* The Worker's config and the usage D1 schema: usage-d1 (emulator tier) owns their D1 checks, the meter
     sentence and the billed rows an event, so a push that changes only one of them runs it before it deploys. */
  w('wrangler.toml', 'USAGE_DAILY_CAP = "2000"\n'); const toml = commit('the cap only');
  r = judge(t, rangesFromStdin(t, stdin(toml, plainTest)));
  ok('a push that changes only wrangler.toml runs the emulator tier', r.tier === 'emulator', r);
  w('schema/usage.sql', 'CREATE INDEX x ON usage_events(name);\n'); const schema = commit('an index only');
  r = judge(t, rangesFromStdin(t, stdin(schema, toml)));
  ok('and so does one that changes only schema/usage.sql', r.tier === 'emulator', r);
  w('schema/newsletter.sql', 'x\n'); const other = commit('another schema');
  r = judge(t, rangesFromStdin(t, stdin(other, schema)));
  ok('companion: another D1 schema, which no emulator gate reads, stays on the tree tier', r.tier === 'tree', r);

  /* A NEW branch: remote sha all zeros, judged from the merge-base with origin/main, so the root
     commit's own app/index.html does not count against it. */
  g('checkout', '-q', '-b', 'feature', root);
  w('worker.js', 'w\n'); const feat = commit('worker only');
  r = judge(t, rangesFromStdin(t, 'refs/heads/feature ' + feat + ' refs/heads/feature 0000000000000000000000000000000000000000\n'));
  ok('a new branch is judged from its merge-base with origin/main', r.ranges.length === 1 && /merge-base with origin\/main/.test(r.ranges[0]) && r.files.length === 1, r);
  ok('and a Worker-only change there is RED and asks for the emulator tier', r.ok === false && r.tier === 'emulator', r);
  r = judge(t, rangesFromStdin(t, '(delete) 0000000000000000000000000000000000000000 refs/heads/gone ' + root + '\n'));
  ok('deleting a remote branch judges nothing and passes', r.ok === true && r.files.length === 0, r);
  r = judge(t, [{ localRef: 'x', head: feat, base: null }]);
  ok('a range with no base fails closed', r.ok === false && r.errors.length === 1, r);

  /* The CLI the hook calls, end to end, with git's stdin. */
  const cli = spawnSync(process.execPath, [__filename, '--stdin'], { cwd: t, input: stdin(codeOnly), encoding: 'utf8' });
  ok('the CLI exits 1 on a code-only push and says why', cli.status === 1 && /product code changed and no test/.test(cli.stdout), cli.stdout);
  const tier = spawnSync(process.execPath, [__filename, '--stdin', '--tier'], { cwd: t, input: stdin(rules), encoding: 'utf8' });
  ok('--tier prints exactly "emulator" for a rules push', tier.stdout.trim() === 'emulator', tier.stdout);
  const range = spawnSync(process.execPath, [__filename, root + '..' + withTest], { cwd: t, encoding: 'utf8' });
  ok('a <base>..<head> argument works by hand', range.status === 0 && /CHANGE-TEST: PASS/.test(range.stdout), range.stdout);
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  console.log('CHANGE-TEST SELF-TEST: ' + (fail ? 'FAIL' : 'PASS'));
  return fail;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest() ? 1 : 0);
  const cwd = process.cwd();
  let ranges;
  if (args.includes('--stdin')) ranges = rangesFromStdin(cwd, fs.readFileSync(0, 'utf8'));
  else {
    const spec = args.find((a) => a.includes('..'));
    if (!spec) { console.error('usage: node tools/change_test_check.js <base>..<head> | --stdin [--tier] | --self-test'); process.exit(2); }
    const [b, h] = spec.split('..');
    const base = tryGit(cwd, ['rev-parse', b]), head = tryGit(cwd, ['rev-parse', h || 'HEAD']);
    ranges = [{ localRef: spec, remoteRef: spec, base, head: head || h, why: 'by hand' }];
  }
  const rep = judge(cwd, ranges);
  if (args.includes('--tier')) { console.log(rep.tier); process.exit(0); }
  print(rep);
  process.exit(rep.ok ? 0 : 1);
}
module.exports = { rangesFromStdin, judge, PRODUCT, TESTISH, EMU_TRIGGERS };
