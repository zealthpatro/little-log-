#!/usr/bin/env node
/* Crash watch: the iPhone app's crash reports, read every hour and sorted into known and new.
 *
 *   node tools/crash_watch.js                   poll TestFlight crash submissions, classify, report
 *   node tools/crash_watch.js --file <log>      classify one crash log (TestFlight text or simulator .ips)
 *   node tools/crash_watch.js --self-test       offline: fixtures through the parser, classifier and reports
 *   node tools/crash_watch.js --install         write and load the hourly launchd job (ops clone)
 *   node tools/crash_watch.js --install --check lint the job and check the ops clone; changes nothing
 *
 * WHY. TestFlight 2026.46.1 closed at launch on every iPhone, and we heard it from the founder, not from
 * a check (docs/postmortems/2026-11-15-ios-beta-crash-at-launch.md). Apple already has every crash a
 * tester sends; this reads them, so a crash becomes a notification and a written brief within the hour.
 *
 * THE LOOP. Each crash gets a signature (exception type plus the top three frames of the crashed thread,
 * addresses and offsets removed, so the TestFlight text log and a simulator .ips of the same crash match).
 * tools/crash_signatures.json names the crashes we already understand and the build that fixed each.
 *   known      a known signature on a build BEFORE its fix: recorded, no alert (old builds keep crashing)
 *   regressed  a known signature on a build at or after its fix: notify, the fix did not hold
 *   new        a signature we have never seen: notify, and write a brief a fix session starts from
 * The brief carries the frames, the device and OS, and the exact next steps: reproduce with
 * tools/ios_launch_smoke.sh on the same iOS, fix, add the signature here with fixedIn, prove red then
 * green. Nothing here pushes, builds or uploads: shipping a fix stays a person's call.
 *
 * WHERE THINGS GO. ~/cubby-reports only (CUBBY_REPORTS overrides): CRASHES.md (one row per signature),
 * crashes/seen.json, crashes/<signature>.md. Never the repo, which is public: a crash report carries
 * device details and a tester's comment. The tester's email address is never written anywhere.
 *
 * Exit codes: 0 nothing needs a person; 3 something new or regressed; 1 the watch itself failed (and it
 * notifies, because a watcher that goes quiet looks exactly like an app that stopped crashing).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CATALOGUE = path.join(ROOT, 'tools', 'crash_signatures.json');
const LABEL = 'com.cubby.crash-watch';

// ---------- parsing: one shape out of either log format ----------

// Apple's text crash log (what TestFlight returns): "Version:", "OS Version:", "Exception Type:",
// "Triggered by Thread:", then "Thread N Crashed:" and one frame per line.
function parseText(text) {
  const field = (name) => { const m = text.match(new RegExp('^' + name + ':\\s*(.+)$', 'm')); return m ? m[1].trim() : ''; };
  const version = (field('Version').match(/^(\S+)/) || [])[1] || '';
  const thread = (field('Triggered by Thread').match(/\d+/) || ['0'])[0];
  const frames = [];
  const at = text.search(new RegExp('^Thread ' + thread + ' Crashed:', 'm'));
  if (at >= 0) {
    const lines = text.slice(at).split('\n').slice(1);
    for (const line of lines) {
      const m = line.match(/^\d+\s+(\S+)\s+0x[0-9a-fA-F]+\s+(.+)$/);
      if (!m) break;
      frames.push({ module: m[1], symbol: m[2] });
    }
  }
  return {
    format: 'text', version, os: field('OS Version'), device: field('Hardware Model'),
    exception: (field('Exception Type').match(/^(\S+)/) || [])[1] || '', frames,
  };
}

// The JSON .ips a Mac or simulator writes: a one-line header, then the body.
function parseIps(text) {
  const nl = text.indexOf('\n');
  const head = JSON.parse(text.slice(0, nl));
  const body = JSON.parse(text.slice(nl + 1));
  const images = body.usedImages || [];
  const th = (body.threads || [])[body.faultingThread || 0] || {};
  const frames = (th.frames || []).map((f) => ({ module: (images[f.imageIndex] || {}).name || '?', symbol: f.symbol || '?' }));
  const bundle = body.bundleInfo || {};
  return {
    format: 'ips', version: bundle.CFBundleShortVersionString || head.app_version || '',
    os: (body.osVersion && body.osVersion.train) || head.os_version || '', device: body.modelCode || '',
    exception: (body.exception && body.exception.type) || '', frames,
  };
}

function parseLog(text) {
  const t = String(text || '').replace(/^﻿/, '');
  return t.trimStart().startsWith('{') ? parseIps(t.trimStart()) : parseText(t);
}

// "-[UIApplication foo:] + 324 (:-1)" and "-[UIApplication foo:]" are the same frame.
function normSymbol(s) {
  return String(s).replace(/\s+\(.*\)\s*$/, '').replace(/\s+\+\s+\d+\s*$/, '').trim();
}
// App.debug.dylib (a simulator Debug build) and App (a device build) are the same code.
function normModule(m) { return /^App(\.debug\.dylib)?$/.test(m) ? 'App' : m; }

function signature(crash) {
  const top = crash.frames.slice(0, 3).map((f) => normModule(f.module) + ' ' + normSymbol(f.symbol));
  const basis = [crash.exception].concat(top).join('|');
  return { id: crypto.createHash('sha1').update(basis).digest('hex').slice(0, 10), basis, top };
}

// ---------- classifying ----------

// CalVer year.week.release, compared segment by segment as numbers ("2026.46.10" > "2026.46.2").
function cmpVersion(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

function loadCatalogue(file) {
  const j = JSON.parse(fs.readFileSync(file || CATALOGUE, 'utf8'));
  return j.signatures || [];
}

function classify(crash, catalogue) {
  const sig = signature(crash);
  const hay = crash.frames.slice(0, 8).map((f) => normSymbol(f.symbol)).join('\n');
  const known = catalogue.find((k) => k.match && hay.includes(k.match));
  if (!known) return { status: 'new', sig, known: null };
  if (known.fixedIn && crash.version && cmpVersion(crash.version, known.fixedIn) >= 0) return { status: 'regressed', sig, known };
  return { status: 'known', sig, known };
}

// ---------- reporting (all under ~/cubby-reports) ----------

function reportsDir() { return process.env.CUBBY_REPORTS || path.join(os.homedir(), 'cubby-reports'); }

function loadSeen(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'crashes', 'seen.json'), 'utf8')); } catch (e) { return { submissions: {}, signatures: {} }; }
}
function saveSeen(dir, seen) {
  fs.mkdirSync(path.join(dir, 'crashes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'crashes', 'seen.json'), JSON.stringify(seen, null, 1) + '\n');
}

// Only these submission fields are ever kept. The tester's email is deliberately not among them.
function keepFields(sub) {
  const a = (sub && sub.attributes) || {};
  return { createdDate: a.createdDate || '', deviceModel: a.deviceModel || '', osVersion: a.osVersion || '', comment: String(a.comment || '').trim().slice(0, 300) };
}

function brief(sigId, entry) {
  const k = entry.known;
  const lines = [
    '# Crash ' + sigId + (k ? ': ' + k.title : ': not seen before'),
    '',
    '- Status: **' + entry.status + '**' + (k && k.fixedIn ? ' (fixed in ' + k.fixedIn + ')' : ''),
    '- Seen: ' + entry.count + ' time(s), first ' + entry.first + ', last ' + entry.last,
    '- Builds: ' + entry.builds.join(', '),
    '- iOS: ' + entry.os.join(', ') + '; devices: ' + entry.devices.join(', '),
    '- Exception: ' + entry.exception,
    '',
    '## Top of the crashed thread',
    '',
    '```',
  ].concat(entry.frames.map((f, i) => i + '  ' + f), ['```', '']);
  if (entry.comments.length) lines.push('## What the tester wrote', '', ...entry.comments.map((c) => '> ' + c.replace(/\n/g, ' ')), '');
  if (k) lines.push('## What we know', '', k.why || '', '', 'Fix: ' + (k.fix || '?') + (k.postmortem ? '  \nPostmortem: ' + k.postmortem : ''), '');
  lines.push(
    '## Next steps for whoever picks this up',
    '',
    '1. Reproduce: `CUBBY_SIM_UDID=<an iPhone simulator on iOS ' + (entry.os[0] || '?') + '> bash tools/ios_launch_smoke.sh`',
    '   (a launch crash shows there; anything later needs the steps in the tester\'s comment).',
    '2. Fix it in the tracked source (tools/cap_ios_configure.rb for the native shell, app/ for the web app).',
    '3. Add or update its entry in tools/crash_signatures.json with `match`, `fixedIn` (the build that will',
    '   carry the fix) and `fix`, so the next report of it on an old build stays quiet and a report on the',
    '   fixed build shouts.',
    '4. Prove red then green, then ask the founder before any push or TestFlight upload.',
    '');
  return lines.join('\n');
}

function writeReports(dir, seen) {
  fs.mkdirSync(path.join(dir, 'crashes'), { recursive: true });
  const rows = Object.entries(seen.signatures).sort((a, b) => String(b[1].last).localeCompare(String(a[1].last)));
  const out = [
    '# iPhone crashes',
    '',
    'Written by tools/crash_watch.js (hourly). One row per crash signature; each has a brief in crashes/.',
    '',
    '| Status | Signature | What | Count | Builds | Last seen |',
    '|---|---|---|---|---|---|',
  ];
  for (const [id, e] of rows) {
    out.push('| ' + e.status + ' | [' + id + '](crashes/' + id + '.md) | ' + (e.known ? e.known.title : e.frames[0] || '?') + ' | ' + e.count + ' | ' + e.builds.join(', ') + ' | ' + e.last + ' |');
    fs.writeFileSync(path.join(dir, 'crashes', id + '.md'), brief(id, e));
  }
  if (!rows.length) out.push('| none | | No crash reports yet | | | |');
  fs.writeFileSync(path.join(dir, 'CRASHES.md'), out.join('\n') + '\n');
}

// Folds one classified crash into the running state. Returns the alert, if this needs a person.
function record(seen, subId, kept, crash, verdict) {
  seen.submissions[subId] = { sig: verdict.sig.id, at: kept.createdDate, version: crash.version };
  const id = verdict.sig.id;
  const prev = seen.signatures[id];
  const e = prev || { status: verdict.status, known: verdict.known, exception: crash.exception, frames: verdict.sig.top, count: 0, builds: [], os: [], devices: [], comments: [], first: kept.createdDate, last: kept.createdDate };
  e.count += 1;
  const add = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };
  add(e.builds, crash.version); add(e.os, kept.osVersion || crash.os); add(e.devices, kept.deviceModel || crash.device);
  if (kept.comment && e.comments.length < 10) add(e.comments, kept.comment);
  if (kept.createdDate && kept.createdDate > e.last) e.last = kept.createdDate;
  if (kept.createdDate && kept.createdDate < e.first) e.first = kept.createdDate;
  // A signature only gets louder: known -> regressed on a fixed build; new stays new until catalogued.
  const rank = { known: 0, new: 1, regressed: 2 };
  const wasStatus = prev ? prev.status : null;
  if (!prev || rank[verdict.status] > rank[e.status]) e.status = verdict.status;
  e.known = verdict.known;
  seen.signatures[id] = e;
  const alert = (verdict.status === 'new' && !prev) || (verdict.status === 'regressed' && wasStatus !== 'regressed');
  return alert ? { id, status: verdict.status, title: verdict.known ? verdict.known.title : verdict.sig.top[0], version: crash.version } : null;
}

function notify(title, msg) {
  try {
    execFileSync('/usr/bin/osascript', ['-e', 'display notification ' + JSON.stringify(msg) + ' with title ' + JSON.stringify(title)], { stdio: 'ignore' });
  } catch (e) { /* no notification centre (CI): the exit code still says it */ }
}

// ---------- the live poll ----------

async function poll() {
  const asc = require('./asc.js');
  const dir = reportsDir();
  const seen = loadSeen(dir);
  const catalogue = loadCatalogue();
  const a = await asc.app();
  let url = '/apps/' + a.id + '/betaFeedbackCrashSubmissions?limit=50';
  const subs = [];
  while (url) {
    const page = await asc.get(url);
    subs.push(...(page.data || []));
    url = page.links && page.links.next ? page.links.next : null;
  }
  const alerts = [];
  let fresh = 0;
  for (const sub of subs) {
    if (seen.submissions[sub.id]) continue;
    fresh++;
    const log = await asc.get('/betaFeedbackCrashSubmissions/' + sub.id + '/crashLog');
    const text = log && log.data && log.data.attributes ? log.data.attributes.logText : '';
    const crash = parseLog(text);
    const kept = keepFields(sub);
    const al = record(seen, sub.id, kept, crash, classify(crash, catalogue));
    if (al) alerts.push(al);
  }
  saveSeen(dir, seen);
  writeReports(dir, seen);
  console.log('crash watch: ' + subs.length + ' TestFlight crash report(s), ' + fresh + ' new since last run, '
    + Object.keys(seen.signatures).length + ' signature(s). Board: ' + path.join(dir, 'CRASHES.md'));
  for (const al of alerts) {
    const what = al.status === 'regressed' ? 'came back on ' + al.version : 'new on ' + al.version;
    console.log('  ' + al.status.toUpperCase() + ' ' + al.id + ': ' + al.title + ' (' + what + ')');
    notify('Cubby iPhone crash: ' + al.status, al.title + ' (' + what + '). Brief: ~/cubby-reports/crashes/' + al.id + '.md');
  }
  return alerts.length ? 3 : 0;
}

// ---------- launchd ----------

function install(checkOnly) {
  const home = os.homedir();
  const clone = path.join(home, 'cubby-ops', 'little-log-pwa');
  const dest = path.join(home, 'Library', 'LaunchAgents', LABEL + '.plist');
  const tpl = fs.readFileSync(path.join(ROOT, 'tools', 'launchd', LABEL + '.plist'), 'utf8').replace(/__HOME__/g, home);
  if (tpl.includes('__HOME__')) throw new Error('template still has __HOME__');
  const tmp = path.join(os.tmpdir(), LABEL + '.' + process.pid + '.plist');
  fs.writeFileSync(tmp, tpl);
  execFileSync('plutil', ['-lint', tmp], { stdio: 'inherit' });
  const problems = [];
  if (!fs.existsSync(path.join(clone, '.git'))) problems.push('no ops clone at ' + clone);
  if (!fs.existsSync(path.join(home, '.appstore-keys'))) problems.push('no ~/.appstore-keys (the ASC key lives there)');
  problems.forEach((p) => console.log('✋ ' + p));
  if (checkOnly) { console.log('CHECK ONLY. Would write ' + dest + ' (hourly, from ' + clone + ') and load it.'); fs.unlinkSync(tmp); return problems.length ? 1 : 0; }
  if (problems.length) { fs.unlinkSync(tmp); console.log('not installing until the problems above are fixed'); return 1; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.mkdirSync(path.join(home, 'cubby-reports'), { recursive: true });
  fs.copyFileSync(tmp, dest); fs.unlinkSync(tmp);
  const uid = String(process.getuid());
  try { execFileSync('launchctl', ['bootout', 'gui/' + uid + '/' + LABEL], { stdio: 'ignore' }); } catch (e) { /* not loaded yet */ }
  execFileSync('launchctl', ['bootstrap', 'gui/' + uid, dest], { stdio: 'inherit' });
  console.log('installed: ' + dest);
  return 0;
}

// ---------- self-test ----------

function selfTest() {
  let pass = 0, fail = 0;
  const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + name + (info !== undefined ? ': ' + JSON.stringify(info).slice(0, 400) : '')); } };
  const SCENE = '___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke';
  const textLog = (ver, frames, exc) => [
    'Incident Identifier: 00000000-0000-0000-0000-000000000000', 'Hardware Model:      iPhone17,2',
    'Identifier:          com.littlecubby.app', 'Version:             ' + ver + ' (1)', 'Beta:                YES',
    'OS Version:          iPhone OS 27.0 (24A437)', '', 'Exception Type:  ' + (exc || 'EXC_BREAKPOINT (SIGTRAP)'),
    'Triggered by Thread:  0', '', '', 'Thread 0 name:', 'Thread 0 Crashed:',
  ].concat(frames.map((f, i) => i + '   ' + f[0].padEnd(30) + '\t0x00000001' + (920000000 + i * 4096).toString(16) + ' ' + f[1]), ['', 'Thread 1:']).join('\n');
  const sceneFrames = [
    ['UIKitCore', SCENE + ' + 700 (:-1)'], ['libdispatch.dylib', '_dispatch_client_callout + 16 (:-1)'],
    ['libdispatch.dylib', '_dispatch_once_callout + 32 (:-1)'], ['UIKitCore', '-[UIApplication workspace:didCreateScene:withTransitionContext:completion:] + 324 (:-1)'],
    ['App', 'main + 64 (AppDelegate.swift:7)'],
  ];
  const ips = (ver) => JSON.stringify({ app_name: 'App', app_version: '1.0', bug_type: '309', os_version: 'macOS 27.0.1' }) + '\n' + JSON.stringify({
    bundleInfo: { CFBundleShortVersionString: ver, CFBundleIdentifier: 'com.littlecubby.app' }, osVersion: { train: 'macOS 27.0.1' }, modelCode: 'MacBookPro18,2',
    exception: { type: 'EXC_BREAKPOINT', signal: 'SIGTRAP' }, faultingThread: 0,
    usedImages: [{ name: 'UIKitCore' }, { name: 'libdispatch.dylib' }, { name: 'App.debug.dylib' }],
    threads: [{ triggered: true, frames: [
      { imageIndex: 0, symbol: SCENE, symbolLocation: 712 }, { imageIndex: 1, symbol: '_dispatch_client_callout' },
      { imageIndex: 1, symbol: '_dispatch_once_callout' }, { imageIndex: 0, symbol: '-[UIApplication workspace:didCreateScene:withTransitionContext:completion:]' },
      { imageIndex: 2, symbol: '__debug_main_executable_dylib_entry_point' }] }],
  }, null, 1);
  const cat = [{ id: 'no-scene-lifecycle', match: '_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption', title: 'iOS 27 stops an app without the UIScene lifecycle', fixedIn: '2026.46.2', fix: 'x' }];

  // 1. The text parser reads the real TestFlight layout.
  const t1 = parseLog(textLog('2026.46.1', sceneFrames));
  ok('text: version', t1.version === '2026.46.1', t1.version);
  ok('text: exception', t1.exception === 'EXC_BREAKPOINT', t1.exception);
  ok('text: frames stop at the next thread', t1.frames.length === 5, t1.frames.length);
  ok('text: offsets and file refs are not part of the frame', normSymbol(t1.frames[0].symbol) === SCENE, normSymbol(t1.frames[0].symbol));
  // 2. The same crash as a simulator .ips gets the SAME signature (so a repro matches its report).
  const i1 = parseLog(ips('2026.46.1'));
  ok('ips: parsed', i1.format === 'ips' && i1.frames.length === 5 && i1.exception === 'EXC_BREAKPOINT', i1);
  ok('text and .ips of one crash share a signature', signature(t1).id === signature(i1).id, [signature(t1).basis, signature(i1).basis]);
  // 3. Classification by build.
  ok('known on the build before its fix', classify(t1, cat).status === 'known');
  ok('regressed on the fixing build', classify(parseLog(textLog('2026.46.2', sceneFrames)), cat).status === 'regressed');
  ok('versions compare as numbers, not text', cmpVersion('2026.46.10', '2026.46.2') > 0 && cmpVersion('2026.9.1', '2026.46.1') < 0 && cmpVersion('2027.1.1', '2026.53.9') > 0);
  ok('regressed on a LATER build too (46.10 > 46.2)', classify(parseLog(textLog('2026.46.10', sceneFrames)), cat).status === 'regressed');
  const other = parseLog(textLog('2026.46.2', [['App', 'SceneDelegate.open(_:) + 120 (SceneDelegate.swift:52)'], ['App', 'SceneDelegate.scene(_:openURLContexts:) + 88'], ['UIKitCore', '-[UIScene _openURLContexts:] + 40']], 'EXC_BAD_ACCESS (SIGSEGV)'));
  ok('an unknown crash is new', classify(other, cat).status === 'new');
  ok('different crashes get different signatures', signature(other).id !== signature(t1).id);
  // 4. The loop end to end in a throwaway reports dir: alerts once, never twice, never leaks an email.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-watch-'));
  const seen = { submissions: {}, signatures: {} };
  const sub = (id, date, comment) => ({ id, attributes: { createdDate: date, deviceModel: 'iPhone17_2', osVersion: '27.0', comment, email: 'tester@example.invalid' } });
  const a1 = record(seen, 'S1', keepFields(sub('S1', '2026-11-15T12:30:09Z', 'Crashed.')), t1, classify(t1, cat));
  const a2 = record(seen, 'S2', keepFields(sub('S2', '2026-11-16T09:00:00Z', 'Opened a link from my email and it closed')), other, classify(other, cat));
  const a3 = record(seen, 'S3', keepFields(sub('S3', '2026-11-16T10:00:00Z', '')), other, classify(other, cat));
  const reg = parseLog(textLog('2026.46.2', sceneFrames));
  const a4 = record(seen, 'S4', keepFields(sub('S4', '2026-11-17T08:00:00Z', 'again')), reg, classify(reg, cat));
  const a5 = record(seen, 'S5', keepFields(sub('S5', '2026-11-17T09:00:00Z', 'and again')), reg, classify(reg, cat));
  ok('a known crash on an old build raises nothing', a1 === null, a1);
  ok('a new crash raises one alert', a2 && a2.status === 'new', a2);
  ok('the same new crash again raises nothing more', a3 === null, a3);
  ok('a fixed crash coming back raises one alert', a4 && a4.status === 'regressed', a4);
  ok('and only once', a5 === null, a5);
  writeReports(dir, seen);
  const board = fs.readFileSync(path.join(dir, 'CRASHES.md'), 'utf8');
  const sigOther = signature(other).id;
  const briefOther = fs.readFileSync(path.join(dir, 'crashes', sigOther + '.md'), 'utf8');
  ok('the board lists both signatures', board.includes(sigOther) && board.includes(signature(t1).id), board);
  ok('the board shows the regression', /\| regressed \|/.test(board), board);
  ok('a new crash gets a brief with its frames and next steps', briefOther.includes('SceneDelegate.open(_:)') && briefOther.includes('tools/ios_launch_smoke.sh') && briefOther.includes('crash_signatures.json'), briefOther);
  ok("the brief keeps the tester's words", briefOther.includes('Opened a link from my email'));
  saveSeen(dir, seen);
  const everything = [board, briefOther, fs.readFileSync(path.join(dir, 'crashes', 'seen.json'), 'utf8')].join('\n');
  const hasAddress = (s) => /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/i.test(s);
  ok('no email address is written anywhere', !hasAddress(everything), everything.match(/\S+@\S+/));
  // The absence above proves nothing unless the same matcher finds an address when one is there.
  ok('the address matcher finds a planted address', hasAddress(everything + '\n> reach me at tester@example.invalid'));
  ok('the kept fields never include the email', !('email' in keepFields(sub('S9', '2026-11-18T00:00:00Z', 'x'))) && !JSON.stringify(keepFields(sub('S9', '', ''))).includes('example.invalid'));
  // 5. The catalogue in the repo parses and names the crash that started all this.
  const real = loadCatalogue();
  ok('tools/crash_signatures.json catalogues the scene crash with its fix', real.some((k) => t1.frames.some((f) => normSymbol(f.symbol).includes(k.match)) && k.fixedIn === '2026.47.1'), real);
  ok('every catalogue entry has match, title, fixedIn and fix', real.every((k) => k.match && k.title && k.fixedIn && k.fix), real);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log((fail ? 'CRASH-WATCH SELF-TEST: FAIL' : 'CRASH-WATCH SELF-TEST: PASS') + ' (' + pass + ' passed, ' + fail + ' failed)');
  return fail ? 1 : 0;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const fileArg = args.indexOf('--file');
  (async () => {
    try {
      if (args.includes('--self-test')) process.exit(selfTest());
      if (args.includes('--install')) process.exit(install(args.includes('--check')));
      if (fileArg >= 0) {
        const crash = parseLog(fs.readFileSync(args[fileArg + 1], 'utf8'));
        const v = classify(crash, loadCatalogue());
        console.log(JSON.stringify({ status: v.status, signature: v.sig.id, version: crash.version, os: crash.os, exception: crash.exception, top: v.sig.top, known: v.known && v.known.id }, null, 1));
        process.exit(0);
      }
      process.exit(await poll());
    } catch (e) {
      console.error('crash watch failed: ' + e.message);
      notify('Cubby crash watch did not run', String(e.message).slice(0, 180));
      process.exit(1);
    }
  })();
}

module.exports = { parseLog, signature, classify, cmpVersion, normSymbol };
