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
 *   - require('firebase-admin'), import ... from 'firebase-admin', import('firebase-admin')   (the root)
 *   - admin.credential / admin.firestore( / admin.auth( / admin.storage( / admin.messaging(
 * Then it checks the installed package has the entry points the scripts use.
 *
 *   node tools/admin_sdk_check.js              the check
 *   node tools/admin_sdk_check.js --self-test  and proves it goes red: on main's own tools/ops.js before
 *                                              the fix, on staged lines, and with each branch of the
 *                                              comment stripper broken in turn
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
   ('tools/*.js', 'https://…', /\/*$/) never opens a comment and hides the code after it.
   It reads tokens, not characters, because whether a '/' opens a regex depends on the token before it:
   after a value (a name, a number, a string, ')' ']' '}', a postfix ++) it divides; after an operator,
   '(' or a keyword like return or typeof it opens a regex; a keyword after '.' or '?.' is only a
   property name (counts.new / 2); and the ')' that closes if (…), while (…), for (…) or with (…) is
   followed by a statement, so by a regex. Templates nest: code inside ${…} is code again, with its own
   strings, comments and templates, and its own braces counted. A line comment ends at any of the four
   line terminators. Newlines survive, so line numbers hold.
   History (20 Nov 2026): the first version stripped comments with two regexes, and a glob string hid two
   legacy lines from it. The second read characters, and a review found divisions it took for regexes
   (after .new, after done++) and regexes it took for divisions (after if (…), after throw), each of
   which could hide real code. On every tracked script this one blanks exactly the comments esprima's
   tokenizer finds; the one file esprima 4 cannot read is tools/xss_sink_check.js (a U+2028 inside a
   string, legal since ES2019), where it agrees once that character is masked. */
const LINE_END = /[\n\r\u2028\u2029]/;
const SPACE = /[\s\ufeff]/;
const ID_START = /[A-Za-z_$\u0080-\uffff]/;
const ID_PART = /[A-Za-z0-9_$\u0080-\uffff]/;
const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'extends']);
const CONTROL = new Set(['if', 'while', 'for', 'with']);
function code(src) {
  const n = src.length, out = [];
  let i = 0;
  let regexOk = true;    // would a '/' here open a regex? yes at the start, after operators and some keywords
  let afterDot = false;  // the last token was '.' or '?.', so a keyword next is a property name
  let word = '';         // the name just before a '(': if, while, for and with make their ')' regex-ok
  const parens = [];     // for each open '(': was it opened by if, while, for or with?
  const holes = [];      // brace depth inside each open ${ … }
  const blank = (s) => s.replace(/[^\n\r\u2028\u2029]/g, ' ');
  const set = (r) => { regexOk = r; afterDot = false; word = ''; };
  const template = () => { // i is just past a backtick, or just past the } that closes a ${ … }
    let j = i;
    while (j < n) {
      const e = src[j];
      if (e === '\\') { j += 2; continue; }                                       // template escape
      if (e === '`') { out.push(src.slice(i, j + 1)); i = j + 1; set(false); return; }
      if (e === '$' && src[j + 1] === '{') { out.push(src.slice(i, j + 2)); i = j + 2; holes.push(0); set(true); return; }
      j++;
    }
    out.push(src.slice(i)); i = n;
  };
  if (src.startsWith('#!')) { let j = 2; while (j < n && !LINE_END.test(src[j])) j++; out.push(src.slice(0, j)); i = j; }
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (SPACE.test(c)) { out.push(c); i++; continue; }
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2), end = j < 0 ? n : j + 2;
      out.push(blank(src.slice(i, end))); i = end; continue;
    }
    if (c === '/' && d === '/') {
      let j = i + 2; while (j < n && !LINE_END.test(src[j])) j++;                // any of the four line ends
      out.push(blank(src.slice(i, j))); i = j; continue;
    }
    if (c === '`') { i++; out.push('`'); template(); continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n' && src[j] !== '\r') { if (src[j] === '\\') j++; j++; } // string escape
      out.push(src.slice(i, j + 1)); i = j + 1; set(false); continue;
    }
    if (c === '/' && regexOk) {
      let j = i + 1, cls = false;
      while (j < n && !LINE_END.test(src[j])) {
        const e = src[j];
        if (e === '\\') { j += 2; continue; }                                     // regex escape
        if (e === '[') cls = true; else if (e === ']') cls = false; else if (e === '/' && !cls) break;
        j++;
      }
      if (src[j] === '/') {
        j++; while (j < n && ID_PART.test(src[j])) j++;                          // flags
        out.push(src.slice(i, j)); i = j; set(false); continue;
      }
      // Not a regex after all (no closing '/' on the line): read it as an operator.
    }
    if (ID_START.test(c)) {
      let j = i + 1; while (j < n && ID_PART.test(src[j])) j++;
      const w = src.slice(i, j); out.push(w); i = j;
      const dot = afterDot;
      set(!dot && REGEX_AFTER.has(w));                                           // keyword, unless a property name
      word = dot ? '' : w;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d))) {
      let j = i + 1; while (j < n && /[0-9A-Za-z_.]/.test(src[j])) j++;
      out.push(src.slice(i, j)); i = j; set(false); continue;
    }
    if (c === '.' && d === '.' && src[i + 2] === '.') { out.push('...'); i += 3; set(true); continue; }
    if (c === '.') { out.push(c); i++; set(false); afterDot = true; continue; }
    if (c === '?' && d === '.' && !/[0-9]/.test(src[i + 2] || '')) { out.push('?.'); i += 2; set(false); afterDot = true; continue; }
    if ((c === '+' || c === '-') && d === c) { out.push(c + d); i += 2; const r = regexOk; set(r); continue; } // postfix stays a value
    if (c === '(') { parens.push(CONTROL.has(word)); out.push(c); i++; set(true); continue; }
    if (c === ')') { const ctrl = parens.pop(); out.push(c); i++; set(!!ctrl); continue; }                // if (…) /re/
    if (c === ']') { out.push(c); i++; set(false); continue; }
    if (c === '{') { if (holes.length) holes[holes.length - 1]++; out.push(c); i++; set(true); continue; }  // hole depth
    if (c === '}') {
      if (holes.length) {
        if (holes[holes.length - 1] === 0) { holes.pop(); out.push(c); i++; template(); continue; }
        holes[holes.length - 1]--;
      }
      out.push(c); i++; set(false); continue;
    }
    out.push(c); i++; set(true);
  }
  return out.join('');
}
// A file git still lists but the working tree no longer has (removed with rm, not git rm) is skipped,
// not a crash: the first version died on it with ENOENT and blocked a push for an unrelated reason.
const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return null; } };
function hits(src, strip) {
  const out = [];
  (strip || code)(src).split('\n').forEach((line, i) => {
    RULES.forEach((r) => { if (r.re.test(line)) out.push({ line: i + 1, what: r.what, text: line.trim().slice(0, 120) }); });
  });
  return out;
}
// The sweep, over any list of paths and any reader, so the self-test can hand it a path that is gone.
function sweep(list, reader) {
  const found = [];
  list.forEach((f) => {
    const src = reader(f);
    if (src === null || !/firebase-admin|admin\./.test(src)) return;
    hits(src).forEach((h) => found.push(f + ':' + h.line + '  ' + h.what + '  `' + h.text + '`'));
  });
  return found;
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
const found = sweep(files, read);
ok('no script uses the namespace API (' + files.length + ' tracked scripts read)', !found.length, found.join('\n         '));

// The scripts that do hold the key really are on the modular API: the sweep must have something to judge.
const modular = files.filter((f) => /require\(\s*['"]firebase-admin\/(app|firestore|auth)['"]\s*\)/.test(read(f) || ''));
ok('tools/ops.js is one of the scripts on the modular entry points', modular.includes('tools/ops.js'), modular.join(', '));

/* And the installed package has what they call. Skipped only when the package is not there at all: CI's
   static job never installs it (20 Nov review: asserting it there would have turned main's CI red on
   every push). A package that IS there but lacks an entry point, or whose entry point fails to load,
   is exactly what this exists to catch, and fails (the second review: the first skip caught every error
   as "not installed"). In CI the entry points are still exercised where the package is installed, by
   the emulator job: test/ops-admin.test.js builds a client from app and firestore, and
   test/invite-cleanup.test.js uses auth. */
function installed() {
  const tools = path.join(ROOT, 'tools');
  let entry;
  try { entry = require.resolve('firebase-admin/app', { paths: [tools] }); }
  catch (e) {
    // Absent: no firebase-admin directory anywhere node would look from tools/.
    const dirs = require.resolve.paths('firebase-admin/app').concat([path.join(tools, 'node_modules')]);
    const there = dirs.some((d) => fs.existsSync(path.join(d, 'firebase-admin', 'package.json')));
    return there ? { error: e.code + ': ' + String(e.message).split('\n')[0] } : null;
  }
  let dir = path.dirname(entry), version = '?';
  for (let k = 0; k < 6; k++, dir = path.dirname(dir)) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) { const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (j.name === 'firebase-admin') { version = j.version; break; } }
  }
  try {
    const from = (m) => require(require.resolve(m, { paths: [tools] }));
    return { version, app: from('firebase-admin/app'), fs: from('firebase-admin/firestore'), auth: from('firebase-admin/auth') };
  } catch (e) { return { version, error: e.code + ': ' + String(e.message).split('\n')[0] }; }
}
const pkg = installed();
if (!pkg) console.log('  skip firebase-admin is not installed here, so its entry points are not checked here (CI\'s emulator job installs it and builds a client from it)');
else ok('firebase-admin ' + pkg.version + ' loads, and has initializeApp, cert, getApps, getFirestore and getAuth',
  !pkg.error && ['initializeApp', 'cert', 'getApps'].every((k) => typeof pkg.app[k] === 'function')
    && typeof pkg.fs.getFirestore === 'function' && typeof pkg.auth.getAuth === 'function', pkg.error);

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
    // Several lines: a '/*' or '//' inside a string, a template or a regex must not open a comment over
    // real code. Each line below is wrong on at least one broken stripper in the next block.
    ["const SCAN = 'tools/*.js';\nconst admin = require('firebase-admin');\nconst legacyDb = admin.firestore();\n/* end */", 2],
    ["const re = /['\"\\/*]/g;\nconst admin = require('firebase-admin');\n/* end */", 1],
    ["const glob = `src/*.js`;\nadmin.initializeApp({ credential: admin.credential.cert(sa) });\n/* end */", 1],
    ["const half = total / 2; const admin = require('firebase-admin'); // a division, not a regex", 1],
    ["const u = `${x ? `/*${host}` : ''}`; const admin = require('firebase-admin'); /* end */", 1],
    ["const t = `${a ? `in` : `out`}`; /* admin.firestore() */ const { getAuth } = require('firebase-admin/auth');", 0],
    ["/* admin.credential.cert(sa)\n   admin.firestore() */\nconst { cert } = require('firebase-admin/app');", 0],
    ["const re = /\\/\\//; const admin = require('firebase-admin');", 1],                                          // regex with escaped slashes
    ["function f(p) {\n  return /\\/*$/.test(p);\n}\nconst admin = require('firebase-admin');\n/* end */", 1],     // regex after return
    ["function g(p) {\n  return /* trailing slashes */ /\\/*$/.test(p);\n}\nconst admin = require('firebase-admin');\n/* end */", 1],
    ["throw /\\/*x/;\nconst admin = require('firebase-admin');\n/* end */", 1],                                    // regex after throw
    ["const share = counts.new / counts.total, glob = 'tools/lib/*.js';\nconst admin = require('firebase-admin');\nconst legacyDb = admin.firestore();", 2],
    ["const each = done++ / 2, glob = 'tools/lib/*.js';\nconst admin = require('firebase-admin');", 1],           // postfix ++ then a division
    ["if (p) /\\/*$/.test(p) && log(p);\nconst admin = require('firebase-admin');\n/* end */", 1],                 // regex after if (…)
    ["const r = /[///]/; const admin = require('firebase-admin');", 1],                                           // '/' inside a regex class
    ["const s = 'it\\'s /* not a comment'; const admin = require('firebase-admin'); /* end */", 1],               // an escaped quote
    ["const t = `a \\` /* b`; const admin = require('firebase-admin'); /* end */", 1],                            // an escaped backtick
    ["const t = `${ {a:1} + `/*` }`; const admin = require('firebase-admin'); /* end */", 1],                     // braces inside ${ }
    ["// note\u2028const admin = require('firebase-admin');\n", 1],                                                // U+2028 ends a line comment
    ["// note\rconst admin = require('firebase-admin');\n", 1],                                                    // so does a lone CR
  ];
  staged.forEach(([src, want]) => {
    const n = hits(src).length;
    ok((want ? 'caught (' + want + '): ' : 'left alone: ') + src.replace(/\n/g, ' ⏎ ').replace(/[\r\u2028]/g, ' ↵ '), want ? n >= want : n === 0, 'hits ' + n);
  });
  /* Each branch of the stripper broken in turn, in memory: some staged line above must then come out
     wrong, or that branch could break and stay green (the second review: eight of these stayed green). */
  const text = code.toString();
  const BRANCHES = [
    ['regex literals not recognised', 'if (c === \'/\' && regexOk) {', 'if (false) {'],
    ['keywords never allow a regex', 'set(!dot && REGEX_AFTER.has(w));', 'set(false);'],
    ['a property name after "." read as a keyword', 'set(!dot && REGEX_AFTER.has(w));', 'set(REGEX_AFTER.has(w));'],
    ['the ) of if (…) read as a value', 'set(!!ctrl); continue; }', 'set(false); continue; }'],
    ['postfix ++ read as an operator', 'if ((c === \'+\' || c === \'-\') && d === c) {', 'if (false) {'],
    ['a regex class ignored', "if (e === '[') cls = true; else if (e === ']') cls = false; else if (e === '/' && !cls) break;", "if (e === '/') break;"],
    ['a regex escape ignored', "if (e === '\\\\') { j += 2; continue; }                                     // regex escape", ''],
    ['a string escape ignored', "{ if (src[j] === '\\\\') j++; j++; } // string escape", '{ j++; } // string escape'],
    ['a template escape ignored', "if (e === '\\\\') { j += 2; continue; }                                       // template escape", ''],
    ['braces inside ${ } not counted', 'if (holes.length) holes[holes.length - 1]++; out.push(c)', 'out.push(c)'],
    ['a line comment ends only at \\n', 'while (j < n && !LINE_END.test(src[j])) j++;                // any of the four line ends', "while (j < n && src[j] !== '\\n') j++;"],
    ['templates not recognised', "if (c === '`') { i++; out.push('`'); template(); continue; }", ''],
    ['strings not recognised', "if (c === '\"' || c === \"'\") {", 'if (false) {'],
  ];
  BRANCHES.forEach(([label, from, to]) => {
    const applied = text.split(from).length === 2;
    let broken = null;
    if (applied) {
      try { broken = new Function('LINE_END', 'SPACE', 'ID_START', 'ID_PART', 'REGEX_AFTER', 'CONTROL', 'return ' + text.replace(from, () => to))(LINE_END, SPACE, ID_START, ID_PART, REGEX_AFTER, CONTROL); } catch (e) { broken = null; }
    }
    const wrong = broken ? staged.filter(([src, w]) => { const k = hits(src, broken).length; return w ? k < w : k !== 0; }).length : 0;
    ok('with ' + label + ', some staged line comes out wrong' + (applied ? '' : ' (the branch was not found: the stripper moved)'), applied && !!broken && wrong > 0, 'wrong ' + wrong);
  });
  // The sweep itself, handed a path git lists but the tree has lost: skipped, not a crash.
  let swept = null; try { swept = sweep(['tools/__gone_from_the_tree__.js', 'tools/ops.js'], read); } catch (e) { swept = 'threw ' + e.message; }
  ok('a file git lists but the working tree has lost is skipped by the sweep, not a crash', Array.isArray(swept) && swept.length === 0, String(swept));
  let raw = null; try { raw = sweep(['tools/__gone_from_the_tree__.js'], (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { raw = 'threw'; }
  ok('(the companion) the same path through a bare readFileSync does crash, so the line above is load-bearing', raw === 'threw');
}

if (bad) { console.error('\nADMIN-SDK: FAIL, ' + bad); process.exit(1); }
console.log('\nADMIN-SDK: PASS' + (SELF_TEST ? ', and every staged break went red' : ''));
