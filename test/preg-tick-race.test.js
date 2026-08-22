/* The antenatal tick that would not stay ticked — reproduced end to end, not reasoned about.
 *
 * THE BUG (2026-08-20). A mother ticked an antenatal appointment on her Care tab. It appeared, and
 * about a second later it un-ticked itself. Her journey document held seven appointments and ZERO
 * ticks, with `at` null on every row — not one tap had ever been saved. She was tapping the same
 * boxes over and over, and the founder only found out because he was handed the phone.
 *
 * Two correct-looking lines destroyed each other:
 *
 *   applyPregJourney()  overwrote every field from an incoming snapshot, INCLUDING the whole `appts`
 *                       array, and set knownPregJourney to the server's signature.
 *   syncPregJourney()   refuses to write when `knownPregJourney === sig`. That is an echo guard, and
 *                       on its own it is right.
 *
 * Once the snapshot had erased the local tick, the local signature MATCHED the server's — so the echo
 * guard concluded there was nothing to send. The edit was wiped from memory and its write cancelled in
 * the same breath. Silent, total, and repeatable in any household with other activity.
 *
 * WHY THIS TEST EXISTS IN THIS FORM. The bug needs a SECOND WRITER, so it cannot be seen in ?e2e=1
 * (localStorage only, no listeners) and it cannot be seen by reading the code with confidence. It needs
 * the real sync layer with a real snapshot racing a real local edit. So this drives index.html +
 * store-firebase.js against the Firestore emulator through the localhost-only ?fsemu hook, ticks an
 * appointment in the page, and then writes the PRE-TICK document back from outside — which is exactly
 * what a snapshot carrying another member's slightly older view looks like.
 *
 *   cd test && npm i && node preg-tick-race.test.js
 *
 * It must fail with the fix reverted. That is the point of it.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EMU_PORT = 8182;
const WEB_PORT = 8097;
const UID = 'TICKMOM';
const EXEC_PROJECT = 'demo-cubby-tick';
const PROJECT = 'little-log-a9caa';
const APP_URL = `http://localhost:${WEB_PORT}/app/?fsemu=${EMU_PORT}&fsuid=${UID}`;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ('  ' + JSON.stringify(extra)) : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, url, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', () => resolve({ status: 0, body: '' }));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
const get = (url) => req('GET', url);

/* ---------- outer phase: stand the emulator up, then re-run ourselves inside it ---------- */
if (!process.env.TICK_RACE_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-tickrace-'));
  fs.writeFileSync(path.join(scratch, 'open.rules'),
    "rules_version = '2';\nservice cloud.firestore { match /databases/{db}/documents { match /{document=**} { allow read, write: if true; } } }\n");
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'open.rules' },
    emulators: { firestore: { port: EMU_PORT }, ui: { enabled: false } }
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const env = Object.assign({}, process.env, {
    TICK_RACE_INNER: '1',
    PATH: '/opt/homebrew/opt/openjdk/bin:' + process.env.PATH
  });
  try {
    execFileSync(firebaseBin, [
      'emulators:exec', '--only', 'firestore', '--project', EXEC_PROJECT,
      '--config', path.join(scratch, 'firebase.json'),
      `node ${JSON.stringify(__filename)}`
    ], { cwd: scratch, env, stdio: 'inherit' });
  } catch (e) {
    process.exitCode = e.status || 1;
  }
  return;
}

/* ---------- inner phase: drive the real app against the emulator ---------- */
(async () => {
  let serveProc = null;
  if ((await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200) {
    serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
      { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(WEB_PORT) }) });
    for (let i = 0; i < 40 && (await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200; i++) await sleep(250);
  }

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 45000 });

  let hid = null;
  for (let i = 0; i < 80 && !hid; i++) {
    hid = await page.evaluate(() => { try { return (window.LL && LL.householdId) || null; } catch (e) { return null; } });
    if (!hid) await sleep(250);
  }
  console.log('\nthe app is signed in and syncing');
  ok('a household exists to sync into', !!hid, { hid });
  if (!hid) { console.log('\nFAIL — never booted'); await browser.close(); if (serveProc) serveProc.kill(); process.exit(1); }

  const pregUrl = `http://localhost:${EMU_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/households/${hid}/pregnancy/${UID}`;

  // Give her a pregnancy with the same shape as the real one: seven antenatal rows, none ticked.
  await page.evaluate(() => {
    state.pregnancy = {
      id: 'p1', ownerUid: (window.LL && LL.uid) || 'TICKMOM', stage: 'expecting',
      lmp: Date.now() - 27 * 7 * 86400000, dueDate: Date.now() + 13 * 7 * 86400000, country: 'in',
      appts: [8, 12, 16, 20, 26, 30, 36].map((w, i) => ({ id: 'a' + i, week: w, title: 'ANC ' + w, note: '', done: false, at: null })),
      careTeam: [], symptoms: [], weights: [], bp: [], kicks: [], contractions: [], bag: []
    };
    persist();
  });
  let seeded = false;
  for (let i = 0; i < 60 && !seeded; i++) { seeded = (await get(pregUrl)).status === 200; if (!seeded) await sleep(250); }
  ok('her journey reaches the database at all', seeded);

  const before = await get(pregUrl);
  const beforeDoc = JSON.parse(before.body || '{}');

  console.log('\nshe ticks an appointment, and a snapshot lands mid-flight');
  /* Tick through the app's OWN handler, so this exercises the real path and not a hand-written
     mutation. Then, inside the push debounce, write the PRE-TICK document back from outside — which is
     precisely the shape of a snapshot carrying another member's slightly older view. */
  await page.evaluate(() => {
    const a = state.pregnancy.appts[0];
    if (typeof toggleAppt === 'function') toggleAppt(a.id);
    else { a.done = true; a.at = Date.now(); persist(); }
  });
  await sleep(80);
  /* The echo must be a GENUINE change to the document, or Firestore stores an identical value, fires
     no snapshot, and this whole test passes while exercising nothing — which is exactly what the first
     draft did, and it stayed green with the fix reverted. So carry the PRE-TICK appts (the stale part,
     which is the bug) alongside one new blood-pressure reading (the real part, which makes it a change).
     That is the shape of what she was actually doing: saving a BP entry while an appointment tick was
     still in the push debounce. */
  const staleFields = JSON.parse(JSON.stringify(beforeDoc.fields || {}));
  try {
    staleFields.data.mapValue.fields.bp = { arrayValue: { values: [ { mapValue: { fields: {
      id: { stringValue: 'bp1' }, at: { integerValue: String(Date.now()) },
      sys: { integerValue: '118' }, dia: { integerValue: '76' }
    } } } ] } };
  } catch (e) {}
  const echo = await req('PATCH', pregUrl, { fields: staleFields });
  ok('the stale snapshot was delivered', echo.status === 200, { status: echo.status });
  // It has to have actually changed the stored document, or no listener wakes up.
  const echoed = await get(pregUrl);
  ok('and it really changed the document, so a snapshot fires',
    echoed.status === 200 && echoed.body.indexOf('bp1') > -1, { changed: echoed.body.indexOf('bp1') > -1 });

  await sleep(3000);

  console.log('\nthe tick survives, in memory and in the database');
  const inPage = await page.evaluate(() => {
    const a = (state.pregnancy && state.pregnancy.appts && state.pregnancy.appts[0]) || {};
    return { done: !!a.done, at: a.at || null };
  });
  ok('the app still shows it ticked', inPage.done === true, inPage);

  const after = await get(pregUrl);
  let doneInDb = null, atInDb = null;
  try {
    const j = JSON.parse(after.body || '{}');
    const arr = (((j.fields || {}).data || {}).mapValue || {}).fields || {};
    const appts = ((arr.appts || {}).arrayValue || {}).values || [];
    const first = (appts[0] || {}).mapValue ? appts[0].mapValue.fields : {};
    doneInDb = first.done ? first.done.booleanValue : null;
    atInDb = first.at ? (first.at.integerValue || first.at.doubleValue || null) : null;
  } catch (e) {}
  /* The one that actually mattered to her. In the broken build the echo guard cancelled this write, so
     the row stayed done=false with at=null forever, no matter how many times she tapped it. */
  ok('and the database records it as done', doneInDb === true, { doneInDb, atInDb });
  ok('with a real timestamp, not the null her seven rows all had', !!atInDb, { atInDb });

  ok('no uncaught page errors', errs.length === 0, errs.join(' | '));

  console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  if (serveProc) serveProc.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
