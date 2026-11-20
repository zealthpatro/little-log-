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
  { what: "import('firebase-admin'), the namespace root", re: /\bimport\(\s*['"]firebase-admin['"]\s*\)/ },
  { what: 'admin.credential, gone in firebase-admin 14', re: /\badmin\.credential\b/ },
  { what: 'admin.<service>(), gone in firebase-admin 14', re: /\badmin\.(firestore|auth|storage|messaging|database)\s*\(/ },
];

/* Comments out; strings, template literals and regex literals kept whole, so a '/*' or '//' inside one
   ('tools/*.js', 'https://…', /['"]x/) never opens a comment and hides the code after it (20 Nov review:
   a glob string hid two legacy lines from the first version, which stripped comments with a regex).
   Templates nest: code inside ${…} is code again, with its own strings, comments and templates.
   Newlines survive, so line numbers hold. On every tracked script it blanks exactly the comments
   esprima's tokenizer finds (checked 20 Nov 2026; one minified vendor file esprima cannot read). */
function code(src) {
  const n = src.length;
  let out = '', i = 0, prev = '';
  const holes = []; // one brace depth per open ${ … } of a template
  // A '/' opens a regex where a value cannot end: after an operator, an opening bracket, or a keyword.
  const regexHere = () => prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev)
    || /(^|[^\w$])(return|typeof|case|do|else|in|of|void|yield|await|delete|new)\s*$/.test(out.slice(-16));
  const template = () => { // i is just past a backtick, or past the } that closes a ${ … }
    while (i < n) {
      const e = src[i];
      if (e === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (e === '`') { out += e; i++; prev = 'a'; return; }
      if (e === '$' && src[i + 1] === '{') { out += '${'; i += 2; holes.push(0); prev = '{'; return; }
      out += e; i++;
    }
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2), end = j < 0 ? n : j + 2;
      out += src.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue;
    }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '`') { out += c; i++; template(); continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; prev = 'a'; continue;
    }
    if (c === '/' && regexHere()) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') {
        const e = src[j];
        if (e === '\\') { j += 2; continue; }
        if (e === '[') cls = true; else if (e === ']') cls = false; else if (e === '/' && !cls) break;
        j++;
      }
      if (src[j] === '/') { out += src.slice(i, j + 1); i = j + 1; prev = 'a'; continue; }
    }
    if (holes.length && c === '{') holes[holes.length - 1]++;
    if (holes.length && c === '}') {
      if (holes[holes.length - 1] === 0) { holes.pop(); out += c; i++; template(); continue; }
      holes[holes.length - 1]--;
    }
    out += c; if (!/\s/.test(c)) prev = c; i++;
  }
  return out;
}
// A file git still lists but the working tree no longer has (removed with rm, not git rm) is skipped,
// not a crash: the first version died on it with ENOENT and blocked a push for an unrelated reason.
const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return null; } };
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
  const src = read(f);
  if (src === null || !/firebase-admin|admin\./.test(src)) return;
  hits(src).forEach((h) => found.push(f + ':' + h.line + '  ' + h.what + '  `' + h.text + '`'));
});
ok('no script uses the namespace API (' + files.length + ' tracked scripts read)', !found.length, found.join('\n         '));

// The scripts that do hold the key really are on the modular API: the sweep must have something to judge.
const modular = files.filter((f) => /require\(\s*['"]firebase-admin\/(app|firestore|auth)['"]\s*\)/.test(read(f) || ''));
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
/* Where the package is absent this is skipped, not failed: CI's static job never installs it (20 Nov
   review: asserting it there would have turned main's CI red on every push). The emulator job does
   install it, and test/ops-admin.test.js builds a real client from these same entry points there. */
if (!pkg) console.log('  skip firebase-admin is not installed here, so its entry points are not checked (the emulator tier checks them)');
else {
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
  const want = [RULES[0], RULES[3], RULES[4]].map((r) => r.what);
  ok("main's tools/ops.js before the fix is caught, on the require, the credential and the firestore() lines",
    realHits.length === 3 && want.every((w) => realHits.includes(w)), JSON.stringify(realHits));
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
    ["const m = await import('firebase-admin');", 1],
    // Several lines: a '/*' or '//' inside a string or a regex must not open a comment over real code.
    ["const SCAN = 'tools/*.js';\nconst admin = require('firebase-admin');\nconst legacyDb = admin.firestore();\n/* end */", 2],
    ["const re = /['\"\\/*]/g;\nconst admin = require('firebase-admin');\n/* end */", 1],
    ["const glob = `src/*.js`;\nadmin.initializeApp({ credential: admin.credential.cert(sa) });\n/* end */", 1],
    ["const half = total / 2; const admin = require('firebase-admin'); // a division, not a regex", 1],
    ["const u = `${x ? `/*${host}` : ''}`; const admin = require('firebase-admin'); /* end */", 1],
    ["const t = `${a ? `in` : `out`}`; /* admin.firestore() */ const { getAuth } = require('firebase-admin/auth');", 0],
    ["/* admin.credential.cert(sa)\n   admin.firestore() */\nconst { cert } = require('firebase-admin/app');", 0],
  ];
  staged.forEach(([src, want]) => {
    const n = hits(src).length;
    ok((want ? 'caught (' + want + '): ' : 'left alone: ') + src.replace(/\n/g, ' ⏎ '), want ? n >= want : n === 0, 'hits ' + n);
  });
  ok('a file git lists but the working tree has lost is skipped, not a crash', read('tools/__gone_from_the_tree__.js') === null);
}

if (bad) { console.error('\nADMIN-SDK: FAIL, ' + bad); process.exit(1); }
console.log('\nADMIN-SDK: PASS' + (SELF_TEST ? ', and every staged break went red' : ''));
