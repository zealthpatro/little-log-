#!/usr/bin/env node
/* Every script that holds the admin key talks to firebase-admin through its modular entry points.
 *
 * firebase-admin 14 (what `npm install firebase-admin` pulls today, 14.2.0 in tools/node_modules) keeps
 * no namespace API: `require('firebase-admin')` still loads, but admin.credential and admin.firestore()
 * are undefined. tools/ops.js was the last script written the old way, and Cubby Ops threw
 * "Cannot read properties of undefined (reading 'cert')" on every /api/data until 16 November 2026,
 * so the dashboard drew nothing. analytics.js, page_stats.js and rag/question_gaps.js each hit the same
 * wall earlier and were moved one at a time; this check is so the next script does not need a crash.
 *
 * It reads every tracked .js/.mjs/.cjs file outside node_modules, with comments taken out (three of
 * the moved scripts describe the old API in a comment), and fails on:
 *   - require('firebase-admin') or import ... from 'firebase-admin'   (the namespace root)
 *   - admin.credential / admin.firestore( / admin.auth( / admin.storage( / admin.messaging(
 * Then it checks the installed package has the entry points the scripts use.
 *
 *   node tools/admin_sdk_check.js              the check
 *   node tools/admin_sdk_check.js --self-test  and proves the matcher goes red: on main's own
 *                                              tools/ops.js before the fix, and on staged lines
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SELF_TEST = process.argv.includes('--self-test');
// Git inside a hook exports GIT_DIR naming the shared repo; never let it steer this read.
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (args) => execFileSync('git', args, { cwd: ROOT, env: gitEnv, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });

const RULES = [
  { what: "require('firebase-admin'), the namespace root", re: /\brequire\(\s*['"]firebase-admin['"]\s*\)/ },
  { what: "import from 'firebase-admin', the namespace root", re: /\bfrom\s+['"]firebase-admin['"]/ },
  { what: 'admin.credential, gone in firebase-admin 14', re: /\badmin\.credential\b/ },
  { what: 'admin.<service>(), gone in firebase-admin 14', re: /\badmin\.(firestore|auth|storage|messaging|database)\s*\(/ },
];

/* Comments out, strings kept. A line comment starts only after whitespace or at the start of a line,
   so 'https://…' inside a string is left alone. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[ \t])\/\/.*$/gm, '$1');
}
function hits(src) {
  const out = [];
  code(src).split('\n').forEach((line, i) => {
    RULES.forEach((r) => { if (r.re.test(line)) out.push({ line: i + 1, what: r.what, text: line.trim().slice(0, 120) }); });
  });
  return out;
}

let bad = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('  ok   ' + name);
  else { bad++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
};

console.log('\nfirebase-admin: modular entry points only\n');

const files = git(['ls-files', '-z', '--', '*.js', '*.mjs', '*.cjs']).split('\0')
  // This file spells the old API out in its rules and its self-test, so it reads everything but itself.
  .filter((f) => f && !/(^|\/)node_modules\//.test(f) && f !== 'tools/admin_sdk_check.js');
ok('there are scripts to read, so the sweep below is not passing on nothing', files.length > 50, files.length + ' files');
const found = [];
files.forEach((f) => {
  let src; try { src = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return; }
  if (!/firebase-admin|admin\./.test(src)) return;
  hits(src).forEach((h) => found.push(f + ':' + h.line + '  ' + h.what + '  `' + h.text + '`'));
});
ok('no script uses the namespace API (' + files.length + ' tracked scripts read)', !found.length, found.join('\n         '));

// The scripts that do hold the key really are on the modular API: the sweep must have something to judge.
const modular = files.filter((f) => /require\(\s*['"]firebase-admin\/(app|firestore|auth)['"]\s*\)/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
ok('tools/ops.js is one of the scripts on the modular entry points', modular.includes('tools/ops.js'), modular.join(', '));

// And the installed package has what they call.
let pkg = null;
try {
  const where = (m) => require.resolve(m, { paths: [path.join(ROOT, 'tools')] });
  // package.json is not in the package's exports map, so find it by walking up from an entry point.
  let dir = path.dirname(where('firebase-admin/app')), version = '?';
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) { const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (j.name === 'firebase-admin') { version = j.version; break; } }
  }
  pkg = { app: require(where('firebase-admin/app')), fs: require(where('firebase-admin/firestore')),
    auth: require(where('firebase-admin/auth')), version };
} catch (e) { pkg = null; }
ok('firebase-admin is installed in tools/node_modules', !!pkg,
  'npm install --no-save --prefix tools firebase-admin (or link tools/node_modules in a worktree, see CLAUDE.md)');
if (pkg) {
  ok('firebase-admin ' + pkg.version + ' has initializeApp, cert, getApps, getFirestore and getAuth',
    ['initializeApp', 'cert', 'getApps'].every((k) => typeof pkg.app[k] === 'function')
      && typeof pkg.fs.getFirestore === 'function' && typeof pkg.auth.getAuth === 'function');
}

if (SELF_TEST) {
  console.log('\nself-test: the matcher must go red\n');
  // Red on the real thing: tools/ops.js as main had it, the file that crashed.
  // The static CI job checks out at depth 1 (.github/workflows/gates.yml), where that commit is absent, so
  // it reads the same three lines as they stood there instead of going red for a missing object.
  const MAIN_OPS = "  const admin = require('firebase-admin');\n  let sa;\n"
    + '  admin.initializeApp({ credential: admin.credential.cert(sa) });\n  db = admin.firestore();\n';
  let before;
  try { before = git(['show', '58733b16:tools/ops.js']); } catch (e) { before = MAIN_OPS; console.log('  (no history here: reading the lines main had, not the file)'); }
  const realHits = hits(before).map((h) => h.what);
  ok("main's tools/ops.js before the fix is caught, on the require, the credential and the firestore() lines",
    realHits.length === 3 && RULES.slice(0, 1).concat(RULES.slice(2)).every((r) => realHits.includes(r.what)), JSON.stringify(realHits));
  const staged = [
    ["const admin = require('firebase-admin');", 1],
    ['import admin from "firebase-admin";', 1],
    ['admin.initializeApp({ credential: admin.credential.cert(sa) });', 1],
    ['const auth = admin.auth();', 1],
    ['  db = admin.firestore();  // after code, still code', 1],
    // Companions: these are what the moved scripts actually contain, and must stay green.
    ["// firebase-admin 14 dropped admin.initializeApp()/admin.firestore() for these", 0],
    ['/* not the legacy `admin.credential.cert` */', 0],
    ["const { initializeApp, cert } = require('firebase-admin/app');", 0],
    ["try { require.resolve('firebase-admin'); } catch (e) {}", 0],
    ["const url = 'https://x.test/'; const { getFirestore } = require('firebase-admin/firestore');", 0],
  ];
  staged.forEach(([line, want]) => {
    const n = hits(line).length;
    ok((want ? 'caught: ' : 'left alone: ') + line, want ? n >= 1 : n === 0, 'hits ' + n);
  });
}

if (bad) { console.error('\nADMIN-SDK: FAIL, ' + bad); process.exit(1); }
console.log('\nADMIN-SDK: PASS' + (SELF_TEST ? ', and every staged break went red' : ''));
