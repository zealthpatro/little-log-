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
const COPY = ['workers/admin', 'workers/shared', 'workers/funnel', 'schema/newsletter.sql', 'app/fonts', 'tools/admin_assets_build.js', 'wrangler.toml', '.assetsignore', 'worker.js'];

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
function runMutant(testFile, m, extraEnv) {
  const tmp = copyTree();
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

/* Runs every mutant; reports through ok(). Each must apply and must make the suite exit non-zero. */
function selfTest(testFile, mutants, ok) {
  console.log('\nself-test: each rule broken on purpose in a temp copy must turn this suite RED');
  for (const m of mutants) {
    const r = runMutant(testFile, m);
    const firstFail = (r.out.split('\n').find((l) => /^\s*FAIL /.test(l)) || '').trim();
    ok('mutant "' + m.name + '" goes red' + (firstFail ? ' (' + firstFail.slice(5, 120) + ')' : ''), r.applied && r.code !== 0, r.applied ? r.out.split('\n').slice(-6).join(' | ') : r.out);
  }
}

module.exports = { runMutant, selfTest, REPO };
