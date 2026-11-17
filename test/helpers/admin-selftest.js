/* Red on purpose: copy the admin's sources into a temp tree, break ONE rule there, and re-run a test file
 * against the copy. The suite must FAIL on every mutant, or the assertion that should catch it is green
 * for free. (The pattern of test/dose-membership.test.js --self-test.)
 *
 * The test under mutation reads its modules from process.env.ADMIN_ROOT, so it grades the copy, never
 * this checkout. Temp trees go in os.tmpdir() and are left for the OS to clear: nothing here deletes.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const COPY = ['workers/admin', 'workers/shared', 'workers/funnel', 'workers/usage', 'schema/newsletter.sql', 'schema/usage.sql', 'app/fonts', 'tools/admin_assets_build.js', 'wrangler.toml', '.assetsignore', 'worker.js'];
/* A mutant that dies because the copy is missing a file proves nothing about the rule it broke. Before
   workers/usage joined this list, the copy's worker.js could not load (from the usage-pipeline base on it
   imports workers/usage/core.mjs), so test/admin-access-log.test.js, which imports worker.js and catches
   the failure, failed "worker.js exposes the Monday digest to tests" under every mutant: red for a reason
   this matcher cannot see, since the error is swallowed. Suites that load workers/usage directly
   (admin-screens and admin-no-content, through the dev sample, from phase 2) die on ERR_MODULE_NOT_FOUND,
   which it does see. Suites that load neither were not affected. */
const WRONG_REASON = /ERR_MODULE_NOT_FOUND|Cannot find module|mutation "[^"]*" did not apply/;

function copyTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-admin-mutant-'));
  for (const rel of COPY) {
    const src = path.join(REPO, rel);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(tmp, rel), { recursive: true });
  }
  return tmp;
}

/* m: { name, file, find, replace } (file relative to the repo root; find must occur). */
function runMutant(testFile, m, extraEnv, prepare) {
  const tmp = copyTree();
  if (prepare) prepare(tmp);
  const files = Array.isArray(m.file) ? m.file : [m.file];
  for (let i = 0; i < files.length; i++) {
    const f = path.join(tmp, files[i]);
    const find = Array.isArray(m.find) ? m.find[i] : m.find;
    const replace = Array.isArray(m.replace) ? m.replace[i] : m.replace;
    if (find === null) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, replace); continue; }
    const src = fs.readFileSync(f, 'utf8');
    if (!src.includes(find)) return { applied: false, code: 0, out: 'mutation "' + m.name + '" did not apply: text not found in ' + files[i] };
    fs.writeFileSync(f, src.split(find).join(replace));
  }
  const r = spawnSync(process.execPath, [testFile], { env: Object.assign({}, process.env, { ADMIN_ROOT: tmp, ADMIN_MUTANT: m.name }, extraEnv || {}),
    encoding: 'utf8', timeout: 240000, maxBuffer: 1 << 26 });
  return { applied: true, code: r.status, out: (r.stdout || '') + (r.stderr || ''), tmp };
}

/* The CONTROL: the same suite against an unaltered copy, which must pass (exit 0, no FAIL line, nothing
   matching WRONG_REASON). A copy that cannot run the suite (a file missing from COPY, a module worker.js
   gained) turns every mutant red for a reason no rule caused, and a suite that swallows the failure
   (test/admin-access-log.test.js catches a worker.js that will not load) hides it from WRONG_REASON. So no
   mutant counts until the control has passed. `prepare(tmp)` may alter the copy first: only to prove, from a
   suite's own self-test, that a control on a broken copy goes red. */
const CONTROL = 'control (no change)';
function controlRun(testFile, prepare) {
  const r = runMutant(testFile, { name: CONTROL, file: [], find: [], replace: [] }, null, prepare);
  const failLine = (r.out.split('\n').find((l) => /^\s*FAIL /.test(l)) || '').trim();
  const wrong = WRONG_REASON.test(r.out);
  return { passed: r.code === 0 && !failLine && !wrong, code: r.code, failLine, wrong, tail: r.out.split('\n').slice(-6).join(' | ') };
}

/* Runs the control, then every mutant; reports through ok(). Each mutant must apply and must make the suite
   exit non-zero, and counts only after the control passed. `opts.prepare(tmp)` alters every copy, the
   control's and each mutant's, before the run: only for the self-test of this function
   (test/admin-access-log.test.js runs it on a copy whose worker.js cannot load, with one harmless mutant, and
   requires the control to fail and the mutant to be reported "not counted"). */
function selfTest(testFile, mutants, ok, opts) {
  const prepare = opts && opts.prepare;
  console.log('\nself-test: the suite passes on an unaltered copy, then each rule broken on purpose in a temp copy must turn it RED');
  const c = controlRun(testFile, prepare);
  ok('control: the suite passes on an unaltered temp copy, so a red mutant below is red for its own rule', c.passed,
    c.wrong ? 'the copy cannot run the suite: ' + c.tail : (c.failLine || c.tail));
  for (const m of mutants) {
    if (!c.passed) { ok('mutant "' + m.name + '" not counted: the control run failed', false); continue; }
    const r = runMutant(testFile, m, null, prepare);
    const firstFail = (r.out.split('\n').find((l) => /^\s*FAIL /.test(l)) || '').trim();
    const wrong = WRONG_REASON.test(r.out);
    ok('mutant "' + m.name + '" goes red' + (firstFail ? ' (' + firstFail.slice(5, 120) + ')' : ''), r.applied && r.code !== 0 && !wrong,
      wrong ? 'red for the wrong reason: ' + (r.out.match(WRONG_REASON) || [])[0] : (r.applied ? r.out.split('\n').slice(-6).join(' | ') : r.out));
  }
}

module.exports = { runMutant, selfTest, controlRun, REPO, WRONG_REASON };
