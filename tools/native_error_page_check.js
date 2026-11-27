#!/usr/bin/env node
/* The native app's error page shows only for a real failure, never for a cancelled load.
 *
 *   node tools/native_error_page_check.js              judge this checkout
 *   node tools/native_error_page_check.js --self-test  stage each failure below first and require it red
 *   node tools/native_error_page_check.js --root=<dir> judge another tree (the self-test uses this)
 *
 * Capacitor's server.errorPath loads its page on EVERY failed main-frame load, including NSURLErrorCancelled
 * (-999, a sign-in or invite link interrupting the first load) and WebKit 102 (a link handed to Safari), so
 * a parent was stranded on a false error page and the link they tapped was dropped. errorPath is off and
 * native-ios/CubbyBridgeViewController.swift asks native-ios/CubbyLoadFailure.swift first.
 *
 * What it refuses: server.errorPath in capacitor.config.json; a classifier that says yes to a cancelled load,
 * a WebKit error or an unrelated URL error, or no to being offline (on a Mac the classifier file itself is
 * compiled and run; everywhere its code list is read); a bridge whose failure callbacks skip the classifier
 * or stop forwarding to Capacitor; a configure script that no longer compiles both files or points the
 * storyboard at the subclass; an error page that retries by itself on load or follows a link off the site.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ARGS = process.argv.slice(2);
const ROOT = (ARGS.find((a) => a.startsWith('--root=')) || '').slice(7) || path.join(__dirname, '..');
const CONFIG = 'capacitor.config.json';
const CLASSIFIER = 'native-ios/CubbyLoadFailure.swift';
const BRIDGE = 'native-ios/CubbyBridgeViewController.swift';
const CONFIGURE = 'tools/cap_ios_configure.rb';
const PAGE = 'cap-web/error.html';
const FILES = [CONFIG, CLASSIFIER, BRIDGE, CONFIGURE, PAGE];

// [domain, code, shows the error page?]
const CASES = [
  ['NSURLErrorDomain', -999, false],    // cancelled: a second navigation (the sign-in or invite link)
  ['WebKitErrorDomain', 102, false],    // frame load interrupted: a link handed to Safari
  ['WebKitErrorDomain', 101, false],
  ['NSURLErrorDomain', -1100, false],   // file does not exist: not a connection problem
  ['NSURLErrorDomain', -1009, true],    // not connected to the internet
  ['NSURLErrorDomain', -1001, true],    // timed out
  ['NSURLErrorDomain', -1004, true],    // cannot connect to host
  ['NSURLErrorDomain', -1003, true],    // cannot find host
];
const NAMES = { NSURLErrorCancelled: -999, NSURLErrorFileDoesNotExist: -1100, NSURLErrorNotConnectedToInternet: -1009 };

let swiftc;
function haveSwiftc() {
  if (swiftc === undefined) swiftc = process.platform === 'darwin' && spawnSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' }).status === 0;
  return swiftc;
}

function runClassifier(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-loadfailure-'));
  try {
    fs.writeFileSync(path.join(dir, 'CubbyLoadFailure.swift'), src);
    fs.writeFileSync(path.join(dir, 'main.swift'), 'import Foundation\n' + CASES.map(([d, c]) =>
      `print("${d} ${c} \\(CubbyLoadFailure.showsErrorPage(NSError(domain: "${d}", code: ${c})))")`).join('\n') + '\n');
    const out = path.join(dir, 'run');
    const b = spawnSync('xcrun', ['swiftc', '-O', '-o', out, path.join(dir, 'CubbyLoadFailure.swift'), path.join(dir, 'main.swift')], { encoding: 'utf8' });
    if (b.status !== 0) return { err: `${CLASSIFIER} does not compile: ${(b.stderr || '').split('\n').find((l) => /error/.test(l)) || b.stderr}` };
    const r = spawnSync(out, [], { encoding: 'utf8' });
    const got = {};
    for (const l of (r.stdout || '').trim().split('\n')) { const [d, c, v] = l.split(' '); got[`${d} ${c}`] = v === 'true'; }
    return { got };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function judge(root, opts = {}) {
  const fails = [];
  const read = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (e) { return null; } };
  for (const f of FILES) if (read(f) === null) fails.push(`${f} is missing`);
  if (fails.length) return fails;

  let cfg;
  try { cfg = JSON.parse(read(CONFIG)); } catch (e) { return [`${CONFIG} does not parse`]; }
  if (cfg.server && 'errorPath' in cfg.server) fails.push(`${CONFIG}: server.errorPath is set; Capacitor shows it for cancelled loads too (-999)`);

  // The classifier, read: its code list and its domain check.
  const cls = read(CLASSIFIER);
  const list = (/errorPageCodes: Set<Int> = \[([\s\S]*?)\]/.exec(cls) || [])[1];
  if (!list) fails.push(`${CLASSIFIER}: no errorPageCodes list`);
  else {
    const names = list.replace(/\/\/.*$/gm, '').match(/NSURLError\w+/g) || [];
    if (/-?\d{2,}/.test(list.replace(/\/\/.*$/gm, ''))) fails.push(`${CLASSIFIER}: errorPageCodes must name Foundation constants, not bare numbers`);
    for (const n of ['NSURLErrorCancelled', 'NSURLErrorFileDoesNotExist']) if (names.includes(n)) fails.push(`${CLASSIFIER}: ${n} (${NAMES[n]}) would show the error page`);
    if (!names.includes('NSURLErrorNotConnectedToInternet')) fails.push(`${CLASSIFIER}: being offline (-1009) would not show the error page`);
  }
  if (!/return domain == NSURLErrorDomain && errorPageCodes\.contains\(code\)/.test(cls)) fails.push(`${CLASSIFIER}: showsErrorPage must require NSURLErrorDomain AND a listed code`);

  // The classifier, run (a Mac with Xcode): the real Foundation values, through the real file.
  if (!opts.noCompile && haveSwiftc()) {
    const r = runClassifier(cls);
    if (r.err) fails.push(r.err);
    else for (const [d, c, want] of CASES) {
      const got = r.got[`${d} ${c}`];
      if (got !== want) fails.push(`${CLASSIFIER} (compiled): ${d} ${c} shows the error page: ${got}, want ${want}`);
    }
  }

  const br = read(BRIDGE);
  if (!/class CubbyBridgeViewController: CAPBridgeViewController/.test(br)) fails.push(`${BRIDGE}: CubbyBridgeViewController no longer subclasses CAPBridgeViewController`);
  if (!/override func capacitorDidLoad\(\)[\s\S]*?webView\.navigationDelegate = /.test(br)) fails.push(`${BRIDGE}: capacitorDidLoad no longer installs the navigation guard`);
  if (!/private var navigationGuard: CubbyNavigationGuard\?/.test(br)) fails.push(`${BRIDGE}: the guard is not retained (WKWebView holds its navigation delegate weakly)`);
  if (!/forwardingTarget\(for aSelector[\s\S]*?return inner/.test(br)) fails.push(`${BRIDGE}: callbacks are no longer forwarded to Capacitor's handler`);
  for (const cb of ['didFail navigation', 'didFailProvisionalNavigation navigation']) {
    const body = (new RegExp(`func webView\\(_ webView: WKWebView, ${cb}: WKNavigation!, withError error: Error\\) \\{([\\s\\S]*?)\\n    \\}`).exec(br) || [])[1];
    if (!body) fails.push(`${BRIDGE}: no ${cb.split(' ')[0]} callback`);
    else {
      if (!/inner\?\.webView\?\(/.test(body)) fails.push(`${BRIDGE}: ${cb.split(' ')[0]} no longer forwards to Capacitor's handler`);
      if (!/showErrorPageIfReal\(webView, error\)/.test(body)) fails.push(`${BRIDGE}: ${cb.split(' ')[0]} no longer asks the classifier`);
    }
  }
  if (!/guard CubbyLoadFailure\.showsErrorPage\(error\) else \{ return \}/.test(br)) fails.push(`${BRIDGE}: showErrorPageIfReal loads the page without asking CubbyLoadFailure`);

  const rb = read(CONFIGURE);
  if (!/NATIVE_SWIFT = %w\[CubbyLoadFailure\.swift CubbyBridgeViewController\.swift\]/.test(rb)) fails.push(`${CONFIGURE}: NATIVE_SWIFT no longer lists both files`);
  if (!/FileUtils\.cp\(src, File\.join\(APP_DIR, name\)\)/.test(rb)) fails.push(`${CONFIGURE}: no longer copies the guard into ios/App/App`);
  if (!/target\.source_build_phase\.add_file_reference\(ref\)/.test(rb)) fails.push(`${CONFIGURE}: no longer compiles the guard into the App target`);
  if (!/board\.sub\(CAP_ROOT_VC, CUBBY_ROOT_VC\)/.test(rb) || !/abort\([^\n]*\) unless board\.include\?\(CUBBY_ROOT_VC\)/.test(rb)) fails.push(`${CONFIGURE}: no longer points Main.storyboard at CubbyBridgeViewController (and stops if it cannot)`);
  if (!/CUBBY_ROOT_VC = 'customClass="CubbyBridgeViewController" customModule="App" customModuleProvider="target"'/.test(rb)) fails.push(`${CONFIGURE}: CUBBY_ROOT_VC is not the App-module subclass`);

  const page = read(PAGE);
  const js = (/<script>([\s\S]*?)<\/script>/.exec(page) || [])[1] || '';
  if (/sessionStorage|setTimeout|setInterval/.test(js) || /\bgo\(\)/.test(js.replace(/function go\(\)/g, ''))) fails.push(`${PAGE}: retries by itself on load; only the button and the connection coming back may`);
  if (!/indexOf\('https:\/\/little-cubby\.com\/'\) === 0\) to = h/.test(js)) fails.push(`${PAGE}: the failed link is not limited to https://little-cubby.com/`);
  if (/—/.test(page)) fails.push(`${PAGE}: em-dash in the page (DESIGN.md §A7)`);
  return fails;
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-error-page-'));
  const base = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
  const stage = (name, mut) => {
    const d = path.join(tmp, name);
    const files = { ...base };
    mut(files);
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
      fs.writeFileSync(path.join(d, rel), body);
    }
    return d;
  };
  const swap = (s, a, b) => { if (!s.includes(a)) throw new Error(`self-test cannot stage: ${a.slice(0, 60)} not found`); return s.replace(a, b); };
  const cases = [
    ['errorPath back on (the shipped 13a6c68d behaviour)', (f) => { f[CONFIG] = swap(f[CONFIG], '"cleartext": false', '"cleartext": false,\n    "errorPath": "error.html"'); }],
    ['cancelled load listed', (f) => { f[CLASSIFIER] = swap(f[CLASSIFIER], '        NSURLErrorTimedOut,', '        NSURLErrorTimedOut,\n        NSURLErrorCancelled,'); }],
    ['offline not listed', (f) => { f[CLASSIFIER] = swap(f[CLASSIFIER], '        NSURLErrorNotConnectedToInternet,  // -1009\n', ''); }],
    ['domain not checked', (f) => { f[CLASSIFIER] = swap(f[CLASSIFIER], 'return domain == NSURLErrorDomain && errorPageCodes.contains(code)', 'return errorPageCodes.contains(code)'); }],
    ['provisional failure skips the classifier', (f) => { f[BRIDGE] = swap(f[BRIDGE], 'withError: error)\n        showErrorPageIfReal(webView, error)\n    }\n\n    private', 'withError: error)\n        webView.load(URLRequest(url: errorPage))\n    }\n\n    private'); }],
    ['failure no longer forwarded', (f) => { f[BRIDGE] = swap(f[BRIDGE], '        inner?.webView?(webView, didFail: navigation, withError: error)\n', ''); }],
    ['guard not retained', (f) => { f[BRIDGE] = swap(f[BRIDGE], 'private var navigationGuard: CubbyNavigationGuard?', 'private weak var navigationGuard: CubbyNavigationGuard?'); }],
    ['storyboard not pointed at the subclass', (f) => { f[CONFIGURE] = swap(f[CONFIGURE], 'board = board.sub(CAP_ROOT_VC, CUBBY_ROOT_VC) unless board.include?(CUBBY_ROOT_VC)', ''); }],
    ['guard not compiled', (f) => { f[CONFIGURE] = swap(f[CONFIGURE], '  target.source_build_phase.add_file_reference(ref) unless target.source_build_phase.files_references.include?(ref)\n', ''); }],
    ['error page retries on load', (f) => { f[PAGE] = swap(f[PAGE], "  window.addEventListener('online', go);", "  window.addEventListener('online', go);\n  if (navigator.onLine !== false) go();"); }],
    ['error page follows any link', (f) => { f[PAGE] = swap(f[PAGE], "if (h.indexOf('https://little-cubby.com/') === 0) to = h;", 'if (h) to = h;'); }],
  ];
  let bad = 0;
  const clean = judge(stage('clean', () => {}));
  if (clean.length) { console.log(`✖ self-test: the clean staged copy should pass, got: ${clean.join('; ')}`); bad++; }
  for (const [name, mut] of cases) {
    const r = judge(stage(name.replace(/\W+/g, '-'), mut), { noCompile: true });
    if (r.length) console.log(`  ✓ red as it should be: ${name} (${r[0]})`);
    else { console.log(`  ✖ self-test: "${name}" was NOT caught`); bad++; }
  }
  // The compiled half on its own: a classifier that reads right but answers yes to -999 must still go red.
  if (haveSwiftc()) {
    const r = judge(stage('compiled', (f) => { f[CLASSIFIER] = swap(f[CLASSIFIER], 'return domain == NSURLErrorDomain && errorPageCodes.contains(code)\n', 'return domain == NSURLErrorDomain && errorPageCodes.contains(code)\n            || code == -999\n'); }));
    const hit = r.find((x) => /\(compiled\): NSURLErrorDomain -999/.test(x));
    if (hit) console.log(`  ✓ red as it should be: compiled classifier says yes to -999 (${hit})`);
    else { console.log(`  ✖ self-test: the compiled run missed a yes to -999 (${r.join('; ') || 'green'})`); bad++; }
  } else console.log('  · no swiftc here: the compiled half runs on a Mac with Xcode');
  const cli = spawnSync(process.execPath, [__filename, `--root=${stage('cli', cases[0][1])}`], { encoding: 'utf8' });
  if (cli.status === 0) { console.log('  ✖ self-test: the CLI exited 0 with errorPath set'); bad++; }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad) { console.log(`✖ native error page self-test: ${bad} problem(s)`); process.exit(1); }
  console.log(`✓ self-test: ${cases.length} staged failures each went red, the clean copy passed`);
}

if (ARGS.includes('--self-test')) selfTest();
const fails = judge(ROOT);
if (fails.length) {
  for (const f of fails) console.log(`✖ ${f}`);
  process.exit(1);
}
console.log(`✓ native error page: no server.errorPath; only a real failure shows it (${haveSwiftc() ? `${CASES.length} codes run through the compiled classifier` : 'classifier read, not compiled here'}); bridge, configure wiring and page checked`);
