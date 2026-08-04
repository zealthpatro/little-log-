/* Kept-after-loss archive — reload survival, proved end to end rather than reasoned about.
 *
 * THE BUG THIS PINS DOWN (2026-08-04): state.pregnancyArchive — the memories a mother chooses
 * to KEEP when a pregnancy closes in loss (endPregnancy(true)) — was memory-only in cloud mode.
 * persist() never wrote it anywhere, so the next reload silently discarded the scans she had
 * just decided to keep, while the "Your kept memories" row vanished from the holding screen.
 *
 * The fix persists it OWNER-PRIVATE in users/{uid}.pregnancyArchive (self-only by the already-
 * published users rule — no rules change), loaded on the boot read in resolveHousehold, with a
 * per-uid localStorage cache written synchronously on every persist() so a tab closed inside
 * the 350 ms push debounce still cannot lose it. This test drives the REAL app (index.html +
 * store-firebase.js, via the localhost-only ?fsemu hook in firebase-init.js) against the
 * Firestore emulator and asserts:
 *
 *   A. endPregnancy(true) -> the archive lands in users/{uid} (cloud) AND the local cache,
 *      synchronously for the cache (crash window covered)
 *   B. a REAL page reload -> the holding screen still offers "Your kept memories", the sheet
 *      still shows the kept week + note, the photo BYTES are back (owner subcollection
 *      listener), and photoInUse() still protects the byte doc from GC
 *   C. removeKeptMemories' shape (archive = [] + persist) -> cloud clears, reload stays empty
 *      (a deliberate remove is never resurrected by the cache)
 *   D. crash recovery: a fresher cache with no matching cloud write (the artifact a mid-debounce
 *      crash leaves) is restored on boot and pushed back up without any user action
 *
 * Rules are NOT under test here (the emulator runs open rules; a stub user carries no token).
 * The rules side of the same story — users/{uid} self-only, kept bytes readable by the owner
 * with the parent doc gone — is asserted in rules-test.js against the real firestore.rules.
 *
 * Run:  node test/loss-archive-reload.test.js
 * (self-hosting: starts the Firestore emulator via test/node_modules/.bin/firebase on :8181
 *  with scratch open rules, and tools/serve.js on :8080 if not already up. Java via
 *  /opt/homebrew/opt/openjdk/bin like the other emulator tests.)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EMU_PORT = 8181;
const WEB_PORT = 8080;
const UID = 'LOSSMOM';
const EXEC_PROJECT = 'demo-cubby-app';   // what emulators:exec runs as
const PROJECT = 'little-log-a9caa';      // what the app SDK namespaces its writes under (firebase-init.js)
const APP_URL = `http://localhost:${WEB_PORT}/app/?fsemu=${EMU_PORT}&fsuid=${UID}`;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ('  ' + JSON.stringify(extra)) : '')); }
};

function get(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', () => resolve({ status: 0, body: '' }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userDocUrl = `http://localhost:${EMU_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/users/${UID}`;
async function cloudArchive() {
  const r = await get(userDocUrl);
  if (r.status !== 200) return { status: r.status, count: -1, raw: '' };
  let j = {};
  try { j = JSON.parse(r.body); } catch (e) {}
  const f = (j.fields || {}).pregnancyArchive;
  const vals = (f && f.arrayValue && f.arrayValue.values) || [];
  return { status: 200, count: vals.length, raw: r.body, hasStamp: !!(j.fields || {}).pregnancyArchiveAt };
}

/* ---------- outer phase: stand the emulator up, then re-run ourselves inside it ---------- */
if (!process.env.LOSS_ARCH_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-lossarch-'));
  fs.writeFileSync(path.join(scratch, 'open.rules'),
    "rules_version = '2';\nservice cloud.firestore { match /databases/{db}/documents { match /{document=**} { allow read, write: if true; } } }\n");
  // NO singleProjectMode: the exec runs under a demo project id while the app SDK namespaces
  // its writes under its real configured projectId — the emulator must host both quietly.
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'open.rules' },
    emulators: { firestore: { port: EMU_PORT }, ui: { enabled: false } }
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const env = Object.assign({}, process.env, {
    LOSS_ARCH_INNER: '1',
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
  // Web server: reuse one already on :8080, else start our own.
  let serveProc = null;
  if ((await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200) {
    serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')], { stdio: 'ignore' });
    for (let i = 0; i < 40 && (await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200; i++) await sleep(250);
  }

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 850 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  async function waitBooted() {
    for (let i = 0; i < 80; i++) {
      const b = await page.evaluate(() => {
        try { return !!(window.LL && LL.householdId && typeof state !== 'undefined' && !document.getElementById('llAuthOv')); }
        catch (e) { return false; }
      });
      if (b) return true;
      await sleep(250);
    }
    return false;
  }

  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 45000 });
  ok('boot: fresh stub user reaches a booted app (emulator household created)', await waitBooted());

  /* ---- A. a pregnancy with a kept moment, closed in loss via the REAL endPregnancy(true) ---- */
  await page.evaluate(async (uid) => {
    try { closeSheet(); } catch (e) {}
    state.pregnancy = {
      id: 'p1', ownerUid: uid, stage: 'expecting',
      dueDate: Date.now() + 90 * 86400000, lmp: Date.now() - 190 * 86400000, cycleLen: 28,
      appts: [], moments: [{ id: 'm1', week: 12, at: Date.now(), note: 'First scan', photoId: 'ph1' }]
    };
    await PhotoStore.set('ph1',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      { preg: true });
    persist();
  }, UID);
  await sleep(1500); // journey doc + byte doc land

  const afterEnd = await page.evaluate((uid) => {
    endPregnancy(true); // the real flow: builds the archive, pregClear()s the journey, persists
    // The cache write inside persist() is SYNCHRONOUS — read it back before the 350 ms
    // debounced cloud push has had any chance to run. This is the crash-window guarantee.
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem('cubby-pregarch-' + uid)); } catch (e) {}
    return {
      archived: (state.pregnancyArchive || []).length,
      pregGone: !state.pregnancy,
      holding: !!(state.lossHolding && state.lossHolding[uid]),
      cacheCount: cache && cache.arr ? cache.arr.length : -1,
      cacheStamped: !!(cache && cache.at)
    };
  }, UID);
  ok('endPregnancy(true): archive built in memory', afterEnd.archived === 1, afterEnd);
  ok('endPregnancy(true): journey cleared + holding seeded', afterEnd.pregGone && afterEnd.holding, afterEnd);
  ok('cache: written SYNCHRONOUSLY inside persist() (crash window covered)', afterEnd.cacheCount === 1 && afterEnd.cacheStamped, afterEnd);

  await sleep(2500); // debounce + cloud write
  let cloud = await cloudArchive();
  ok('cloud: users/{uid}.pregnancyArchive holds the kept memory', cloud.count === 1, cloud);
  ok('cloud: change stamp written alongside', !!cloud.hasStamp, cloud);
  ok('cloud: the kept note itself made it up', /First scan/.test(cloud.raw));

  /* ---- B. the reload a grieving mother actually does ---- */
  // Drop the local cache FIRST: the restore below may then come only from users/{uid} in
  // Firestore. Without this, a green here could be the cache masking a broken cloud write.
  await page.evaluate((uid) => { localStorage.removeItem('cubby-pregarch-' + uid); }, UID);
  await page.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  ok('reload: app boots again', await waitBooted());
  await sleep(2500); // own preg-photo byte listener catch-up

  const afterReload = await page.evaluate((uid) => {
    const a = state.pregnancyArchive || [];
    const m = (a[0] && a[0].moments && a[0].moments[0]) || {};
    let sheet = '';
    try { openKeptMemories(); sheet = (document.getElementById('sheet') || {}).innerText || ''; closeSheet(); } catch (e) { sheet = 'threw:' + e.message; }
    return {
      count: a.length, week: m.week, note: m.note, photoId: m.photoId,
      holdingScreen: /Take all the time you need/.test(document.body.innerText),
      keptRow: /Your kept memories/.test(document.body.innerText),
      sheetOk: /Week 12/.test(sheet) && /First scan/.test(sheet),
      bytesBack: !!(PhotoStore.map && PhotoStore.map.ph1),
      gcProtected: (typeof photoInUse === 'function') ? photoInUse('ph1') : 'no-fn'
    };
  }, UID);
  ok('RELOAD SURVIVAL: the archive is back (was the bug: memory-only, gone)', afterReload.count === 1, afterReload);
  ok('reload: kept moment intact (week 12, note, photo ref)', afterReload.week === 12 && afterReload.note === 'First scan' && afterReload.photoId === 'ph1', afterReload);
  ok('reload: calm holding screen with the "Your kept memories" row', afterReload.holdingScreen && afterReload.keptRow, afterReload);
  ok('reload: kept-memories sheet renders the memory', afterReload.sheetOk, afterReload);
  ok('reload: photo BYTES restored from pregnancy/{uid}/photos', afterReload.bytesBack, afterReload);
  ok('reload: photoInUse() covers the archived photo (GC can never eat it)', afterReload.gcProtected === true, afterReload);

  /* ---- C. a deliberate remove stays removed (never resurrected by the cache) ---- */
  await page.evaluate((uid) => {
    // removeKeptMemories' core, minus its confirm sheet: bytes go, archive empties, persist.
    (state.pregnancyArchive || []).forEach((a) => (a.moments || []).forEach((m) => { try { PhotoStore.del(m.photoId); } catch (e) {} }));
    state.pregnancyArchive = []; persist();
  }, UID);
  await sleep(2000);
  cloud = await cloudArchive();
  ok('remove: cloud archive cleared to []', cloud.count === 0, cloud);
  await page.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  ok('remove: app boots after the clear', await waitBooted());
  const afterRemove = await page.evaluate(() => ({
    count: (state.pregnancyArchive || []).length,
    keptRow: /Your kept memories/.test(document.body.innerText),
    holdingScreen: /Take all the time you need/.test(document.body.innerText)
  }));
  ok('remove: reload does NOT resurrect it (cloud [] is authoritative)', afterRemove.count === 0 && !afterRemove.keptRow, afterRemove);
  ok('remove: the calm holding screen itself remains', afterRemove.holdingScreen, afterRemove);

  /* ---- D. crash recovery: fresher cache, stale cloud -> restored AND pushed up on boot ---- */
  await page.evaluate((uid) => {
    // The exact artifact a mid-debounce crash leaves: persist() cached the keep synchronously,
    // the tab died before the 350 ms cloud push. (Stamp fresher than the cloud's.)
    localStorage.setItem('cubby-pregarch-' + uid, JSON.stringify({
      at: Date.now(),
      arr: [{ id: 'a2', endedAt: Date.now(), weeks: 9, loss: true, moments: [{ id: 'm2', week: 9, at: Date.now(), note: 'Kept again', photoId: 'ph1' }] }]
    }));
  }, UID);
  await page.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  ok('crash recovery: app boots', await waitBooted());
  const afterCrash = await page.evaluate(() => ({ count: (state.pregnancyArchive || []).length, keptRow: /Your kept memories/.test(document.body.innerText) }));
  ok('crash recovery: fresher cache restored into state on boot', afterCrash.count === 1, afterCrash);
  ok('crash recovery: holding screen offers the kept memories again', afterCrash.keptRow, afterCrash);
  await sleep(2500); // startSync's targeted recovery push
  cloud = await cloudArchive();
  ok('crash recovery: pushed back up WITHOUT user action', cloud.count === 1 && /Kept again/.test(cloud.raw), cloud);

  const realErrs = errs.filter((e) => !/ServiceWorker|serviceworker/i.test(e));
  ok('no uncaught page errors across all phases', realErrs.length === 0, realErrs);

  await browser.close();
  if (serveProc) serveProc.kill();
  console.log(`\nloss-archive-reload: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
