#!/usr/bin/env node
/* Every browser gate finds Chrome through CHROME_PATH, so the same gate runs on the Mac and on CI's Linux.
 *
 *   node tools/chrome_path_check.js              judge every tracked .js/.mjs/.cjs file
 *   node tools/chrome_path_check.js --self-test  stage each way it must go red in a temp dir, then judge
 *
 * WHY (test-speed plan item 4, 28 Nov 2026). The browser tier is moving onto CI's Linux runners, where
 * Chrome is /usr/bin/google-chrome and the workflow names it in CHROME_PATH. Ten gates named the Mac's
 * Chrome bare, so on Linux they could only fail at launch, on a path, never on what they test. The rest
 * already read `process.env.CHROME_PATH || '/Applications/...'`. This keeps it that way.
 *
 * THE RULE.
 *   1. A line that names the Mac Chrome (/Applications/Google Chrome.app) also reads CHROME_PATH, as the
 *      fallback of `process.env.CHROME_PATH || ...`, never as the only way.
 *   2. A file that passes an executablePath to a launch reads CHROME_PATH somewhere, so a path built from
 *      a constant elsewhere in the file cannot slip by rule 1.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/* Built from its parts, here and in the self-test's fixtures, so this file never names the path it judges and
   is judged like every other file (it named it whole until 28 Nov 2026 and flagged its own two lines on CI).
   No file is exempt by name: the self-test plants a bare path in a file called chrome_path_check.js too. */
const MAC = ['', 'Applications', 'Google Chrome.app'].join('/');

/* files: { relPath: source }. Returns the problems, one per line or file. */
function judge(files) {
  const out = [];
  for (const [f, src] of Object.entries(files)) {
    const lines = String(src).split('\n');
    lines.forEach((l, i) => { if (l.includes(MAC) && !l.includes('CHROME_PATH')) out.push(f + ':' + (i + 1) + ' names the Mac Chrome without CHROME_PATH: ' + l.trim().slice(0, 100)); });
    if (/executablePath\s*:/.test(src) && !src.includes('CHROME_PATH')) out.push(f + ' launches Chrome (executablePath) and never reads CHROME_PATH');
  }
  return out;
}
function trackedSources(root) {
  const env = { ...process.env }; for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  const list = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.cjs'], { cwd: root, env, encoding: 'utf8' }).split('\n')
    .filter((f) => f && !f.split('/').includes('node_modules'));
  const files = {};
  for (const f of list) { try { files[f] = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { /* deleted in the working tree */ } }
  return files;
}
function report() {
  const files = trackedSources(ROOT);
  const p = judge(files);
  console.log('\nCHROME_PATH: ' + Object.keys(files).length + ' tracked scripts\n');
  if (!p.length) console.log('  ok   every Mac Chrome path is a fallback of CHROME_PATH, and every launching file reads it');
  for (const x of p) console.log('  FAIL ' + x);
  return p;
}

function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + JSON.stringify(x).slice(0, 500) : '')); } };
  console.log('\nself-test: each way a gate can hard-code the Mac Chrome, staged\n');
  const P = "'" + MAC + "/Contents/MacOS/Google Chrome'";
  const cases = [
    ['a bare constant (household_name, support_reach before 28 Nov)', { 'tools/a_check.js': "const C=" + P + ";\nconst b=await p.launch({executablePath:C});\n" }, /a_check\.js:1 names the Mac Chrome/],
    ['a bare path inside the launch (duedate-cycle before 28 Nov)', { 'test/b.test.js': "const b=await puppeteer.launch({executablePath:" + P + ",headless:'new'});\n" }, /b\.test\.js:1 names the Mac Chrome/],
    ['a path built elsewhere and launched with no CHROME_PATH', { 'tools/c_check.js': "const parts=['/Applications','Google Chrome.app'];\nconst b=await p.launch({ executablePath: parts.join('/') });\n" }, /c_check\.js launches Chrome \(executablePath\) and never reads CHROME_PATH/],
    ['CHROME_PATH read on another line but the Mac path named bare', { 'tools/d_check.js': "const X=process.env.CHROME_PATH;\nconst C=" + P + ";\nlaunch({executablePath:X||C});\n" }, /d_check\.js:2 names the Mac Chrome/],
  ];
  for (const [label, files, want] of cases) { const p = judge(files); ok(label + ': red', p.some((x) => want.test(x)), p); }
  const good = { 'tools/e_check.js': "const CHROME = process.env.CHROME_PATH || " + P + ";\nconst b = await puppeteer.launch({ executablePath: CHROME });\n", 'tools/f.js': "// no browser here\nconst x = 1;\n" };
  ok('companion: the CHROME_PATH fallback and a file with no browser are green', judge(good).length === 0, judge(good));
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-chrome-path-'));
  try {
    /* The file walk itself: a tracked bare file is found, an untracked one and one under node_modules are not
       this check's business. And a bare path in a file that has this checker's own name is found as well: the
       checker keeps clear of its own rule by spelling the path in parts, never by an exemption. */
    const env = { ...process.env }; for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
    const git = (a) => execFileSync('git', a, { cwd: T, env, stdio: 'ignore' });
    git(['init', '-q']);
    fs.mkdirSync(path.join(T, 'tools', 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(T, 'tools', 'bare_check.js'), 'const C=' + P + ';\n');
    fs.writeFileSync(path.join(T, 'tools', 'node_modules', 'x', 'index.js'), 'const C=' + P + ';\n');
    fs.writeFileSync(path.join(T, 'tools', 'chrome_path_check.js'), '// a copy that names the path whole\nconst MAC = ' + P + ';\n');
    git(['add', '-f', 'tools/bare_check.js', 'tools/node_modules/x/index.js', 'tools/chrome_path_check.js']);
    const found = judge(trackedSources(T));
    ok('the walk finds a tracked bare file and leaves node_modules alone', found.some((x) => /^tools\/bare_check\.js:1 /.test(x)) && !found.some((x) => /node_modules/.test(x)), found);
    ok('and a bare path in a file named chrome_path_check.js is red too (no file is exempt by name)',
      found.length === 2 && found.some((x) => /^tools\/chrome_path_check\.js:2 names the Mac Chrome/.test(x)), found);
  } catch (e) { ok('the walk stage ran', false, String(e && e.message || e)); }
  finally { fs.rmSync(T, { recursive: true, force: true }); }
  const p = report();
  p.length ? fail++ : pass++;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  return fail;
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) { const f = selfTest(); console.log('CHROME-PATH: ' + (f ? 'FAIL' : 'PASS')); process.exit(f ? 1 : 0); }
  const p = report();
  console.log('\nCHROME-PATH: ' + (p.length ? 'FAIL' : 'PASS'));
  process.exit(p.length ? 1 : 0);
}
module.exports = { judge, trackedSources };
