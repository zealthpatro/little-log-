/* A quick close keeps what she just logged: one phone, the REAL rules and a real Firestore.
 *
 * Chaos finding CH-bd7f70 (seen on live, 2026-11-13): an entry logged and then the app reloaded or
 * closed about 120 ms later was lost from the server AND from that phone, with nothing to say so. With
 * a household, persist() writes nothing on the phone and only arms a 350 ms push, so a page torn down
 * inside that window took the entry with it.
 *
 * Sending the waiting push on pagehide is not enough on its own, and this suite is how that was found:
 * a write issued while the page is being torn down never commits to Firestore's IndexedDB queue, so the
 * entry was still gone after a reload 40 ms later. app/store-firebase.js now also writes an outbox to
 * localStorage at that moment (synchronous), and the next boot puts back what has not landed.
 * test/quick-close.test.js is the tree-tier half (the real functions, the guard that never puts back a
 * write Firestore kept or a change made elsewhere). This is the end-to-end half:
 *
 *   A  a nappy and a medicine, then the app reloads 40 ms later (from the page's own clock)
 *   B  she moves an earlier entry to recently deleted, then a reload 40 ms later: it stays deleted
 *   C  a feed, then she switches away (visibilitychange to hidden) and 100 ms later the app is ended
 *      with no other event at all: the renderer is crashed, the way a phone ends a suspended app
 *   D  nothing is left behind: once everything has landed, no outbox is stored on the phone
 *   E  the control: an entry with time for its push (a reload 900 ms later) reaches the server, so
 *      the lookups above can see an entry when it is there
 *
 * Each timing case first asserts its own window: the page went away within 100 ms of her edit, inside
 * the 350 ms debounce, or the case proves nothing.
 *
 *   node test/quick-close-emulator.test.js
 *   RULES_FILE=/path/to/live.rules node test/quick-close-emulator.test.js     (the deploy window)
 *
 * Ports: FS_PORT, AUTH_PORT, WEB_PORT, HUB_PORT, LOG_PORT, WS_PORT.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FS_PORT = Number(process.env.FS_PORT) || 8767;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9767;
const WEB_PORT = Number(process.env.WEB_PORT) || 8768;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const EXEC_PROJECT = 'demo-cubby-quickclose';
const PAGE_PROJECT = 'little-log-a9caa'; // the id app/firebase-init.js gives the SDK; emulator only
const RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'firestore.rules');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = 'emulator-only-pw-quickclose';
const DEBOUNCE = 350; // scheduledPush's debounce in app/store-firebase.js
const QUICK = 100;    // "closed or reloaded within 100 ms"

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : '')); }
  return !!c;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res) => {
  http.get(url, (r) => { r.resume(); res({ status: r.statusCode }); }).on('error', () => res({ status: 0 }));
});

/* ---------- outer phase: both emulators up, then re-run ourselves inside them ---------- */
if (!process.env.QUICK_CLOSE_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-quickclose-'));
  fs.copyFileSync(RULES_FILE, path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { QUICK_CLOSE_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
  try {
    execFileSync(firebaseBin, [
      'emulators:exec', '--only', 'firestore,auth', '--project', EXEC_PROJECT,
      '--config', path.join(scratch, 'firebase.json'),
      `node ${JSON.stringify(__filename)}`
    ], { cwd: scratch, env, stdio: 'inherit' });
  } catch (e) { process.exitCode = e.status || 1; }
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
  return;
}

/* ---------- emulator admin access (bypasses the rules; reads back) ---------- */
const FS_DOCS = `http://localhost:${FS_PORT}/v1/projects/${PAGE_PROJECT}/databases/(default)/documents/`;
const ADMIN = { 'content-type': 'application/json', authorization: 'Bearer owner' };
function fromValue(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromValue);
  if ('mapValue' in v) { const o = {}; const f = (v.mapValue && v.mapValue.fields) || {}; Object.keys(f).forEach((k) => { o[k] = fromValue(f[k]); }); return o; }
  return v;
}
async function adminGet(p) {
  const r = await fetch(FS_DOCS + p, { headers: ADMIN });
  if (r.status === 404) return null;
  const j = await r.json();
  return fromValue({ mapValue: { fields: j.fields || {} } });
}
async function until(fn, ms) {
  const stop = Date.now() + (ms || 10000);
  let v;
  while (Date.now() < stop) { v = await fn(); if (v) return v; await sleep(100); }
  return v;
}

/* ---------- inner phase ---------- */
(async () => {
  console.log('\na quick close keeps what she just logged, one phone, real rules (' + (process.env.RULES_FILE ? 'RULES_FILE=' + RULES_FILE : 'firestore.rules') + ')\n');
  const serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
    { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(WEB_PORT) }) });
  process.on('exit', () => { try { serveProc.kill(); } catch (e) {} }); // on every way out, a throw included
  for (let i = 0; i < 40 && (await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200; i++) await sleep(250);
  const servedStore = await fetch(`http://localhost:${WEB_PORT}/app/store-firebase.js`).then((r) => r.text()).catch(() => '');
  ok('the static server serves THIS checkout\'s store-firebase.js, byte for byte', servedStore === fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8'));
  const servedIndex = await fetch(`http://localhost:${WEB_PORT}/app/index.html`).then((r) => r.text()).catch(() => '');
  ok('and THIS checkout\'s index.html', servedIndex === fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8'));

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const dl = require(path.join(ROOT, 'tools', 'gate_downloads.js'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', downloadBehavior: dl.downloadBehavior(),
    args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1'] });
  const errs = [], crashes = [], offHostAnswered = [];
  const AUTH_PROJECT = process.env.GCLOUD_PROJECT || EXEC_PROJECT;
  const appUrl = () => `http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}`;
  /* Before any of the page's own scripts: when did this document start going away? */
  const PROBES = () => {
    addEventListener('pagehide', () => { try { sessionStorage.setItem('qc-hide', String(Date.now())); } catch (e) {} });
  };
  const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
  const openPhone = async () => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('error', (e) => crashes.push(String(e && e.message)));
    page.on('response', (rs) => { try { const h = new URL(rs.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHostAnswered.push(h); } catch (e) {} });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(PROBES);
    await page.goto(appUrl(), { waitUntil: 'networkidle2', timeout: 45000 });
    return page;
  };
  const booted = async (page, ms) => {
    try {
      await page.waitForFunction(() => !!(window.LL && window.LL.householdId && typeof state !== 'undefined' && !document.getElementById('llAuthOv')), { timeout: ms || 40000 });
      return true;
    } catch (e) { return false; }
  };
  /* The page reloads itself `ms` after the edit, from its own clock, so no round trip to this script
     widens the window. Resolves once the new document has booted. */
  const editThenReload = async (page, ms, edit) => {
    const nav = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => null);
    const out = await page.evaluate((src, ms) => {
      sessionStorage.removeItem('qc-hide');
      const r = (new Function('return (' + src + ')()'))();
      sessionStorage.setItem('qc-edit', String(Date.now()));
      setTimeout(() => location.reload(), ms);
      return r;
    }, edit.toString(), ms);
    await nav;
    const back = await booted(page, 45000);
    const gone = await page.evaluate(() => Number(sessionStorage.getItem('qc-hide')) - Number(sessionStorage.getItem('qc-edit')));
    return { out, back, gone };
  };
  const serverEvent = (hid, id) => adminGet('households/' + hid + '/events/' + id);
  const phoneEvent = (page, id) => page.evaluate((id) => { const e = (state.events || []).find((x) => x.id === id); return e ? JSON.parse(JSON.stringify(e)) : null; }, id);
  const serverMeds = async (hid) => ((((await adminGet('households/' + hid)) || {}).app || {}).meds || []).map((m) => m.id);
  const outboxes = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('cubby-outbox') === 0));

  /* ================================================================================================
     Setup: Olive signs in and makes a family with a baby */
  console.log('setup: Olive makes a family');
  let O = await openPhone();
  await O.waitForFunction(() => !!(window.LL && window.LL.auth && window.LL.auth.signInWithEmailAndPassword), { timeout: 20000 });
  const made = await fetch(`http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${AUTH_PROJECT}/accounts`,
    { method: 'POST', headers: ADMIN, body: JSON.stringify({ email: 'olive@quickclose.test', password: PW, emailVerified: true }) }).then((r) => r.json()).catch(() => ({}));
  if (!made.localId) throw new Error('could not make the emulator account: ' + JSON.stringify(made).slice(0, 200));
  await O.evaluate((e, p) => window.LL.auth.signInWithEmailAndPassword(e, p).then(() => true), 'olive@quickclose.test', PW);
  ok('Olive boots into a family of her own', await booted(O));
  const { hid } = await O.evaluate(() => ({ hid: window.LL.householdId }));
  await O.evaluate(() => {
    state.babies = [{ id: 'bpip', name: 'Pip', birth: Date.now() - 40 * 86400000, sex: 'M', routines: [], doctors: [], allergies: [] }];
    state.activeBabyId = 'bpip'; persist();
  });
  ok('(the baby reached the server)', !!(await until(async () => ((((await adminGet('households/' + hid)) || {}).app || {}).babies || []).length === 1, 8000)));
  await O.evaluate(() => {
    const u = window.LL.auth.currentUser.uid;
    return window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + u + '.setupDone']: true, ['memberInfo.' + u + '.name']: 'Olive' });
  });
  await sleep(3500); // the bear claims (2 s after a snapshot) settle before any timing-sensitive case

  /* ================================================================================================ */
  console.log('\nA. she logs a nappy and adds a medicine, and the app reloads 40 ms later');
  const A = await editThenReload(O, 40, () => {
    const id = addEvent({ type: 'diaper', kind: 'wet', time: Date.now(), notes: 'quick close A' });
    state.meds.push({ id: 'mQA', name: 'Calpol', dose: '2.5', unit: 'ml', babyId: state.activeBabyId, pattern: { type: 'asNeeded' }, createdAt: Date.now() });
    persist();
    return id;
  });
  ok('(the window was hit: the page went away ' + A.gone + ' ms after her edit, within ' + QUICK + ' ms)', A.gone >= 0 && A.gone < QUICK, A);
  ok('her phone comes back after the reload', A.back);
  ok('the nappy reached the server', !!(await until(() => serverEvent(hid, A.out), 10000)), A.out);
  ok('and is still on her phone', !!(await until(() => phoneEvent(O, A.out), 5000)));
  ok('the medicine reached the server', !!(await until(async () => (await serverMeds(hid)).indexOf('mQA') >= 0, 8000)), await serverMeds(hid));
  ok('and is still on her phone', await O.evaluate(() => (state.meds || []).some((m) => m.id === 'mQA')));

  /* ================================================================================================ */
  console.log('\nB. she moves an earlier entry to recently deleted, and the app reloads 40 ms later');
  await sleep(1500);
  const bId = await O.evaluate(() => addEvent({ type: 'feed', method: 'bottle', amount: 60, time: Date.now() - 3600000, notes: 'quick close B' }));
  ok('(the entry is on the server first)', !!(await until(() => serverEvent(hid, bId), 8000)));
  await sleep(1500);
  const B = await editThenReload(O, 40, new Function('return () => { const e = state.events.find((x) => x.id === ' + JSON.stringify(bId) + '); e.deleted = true; e.deletedBy = window.LL.auth.currentUser.uid; e.deletedAt = Date.now(); persist(); return e.id; }')());
  ok('(the window was hit: the page went away ' + B.gone + ' ms after her edit, within ' + QUICK + ' ms)', B.gone >= 0 && B.gone < QUICK, B);
  ok('her phone comes back after the reload', B.back);
  ok('the entry is deleted on the server', !!(await until(async () => { const e = await serverEvent(hid, bId); return e && e.deleted === true; }, 10000)), await serverEvent(hid, bId));
  ok('and on her phone: it did not come back', !!(await until(async () => { const e = await phoneEvent(O, bId); return e && e.deleted === true; }, 5000)), await phoneEvent(O, bId));

  /* ================================================================================================ */
  console.log('\nC. she logs a feed and switches away; 100 ms later the app is ended with no other event');
  await sleep(1500);
  const C = await O.evaluate(() => {
    const id = addEvent({ type: 'feed', method: 'bottle', amount: 90, time: Date.now(), notes: 'quick close C' });
    const at = Date.now();
    // What a phone does when she switches app: the page is hidden. The app's own listener hears it.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    return { id, at, outbox: Object.keys(localStorage).filter((k) => k.indexOf('cubby-outbox') === 0).length };
  });
  ok('(at the switch, an outbox is stored on her phone: D below can see one)', C.outbox === 1, C);
  await sleep(QUICK);
  const cdp = await O.createCDPSession();
  const crashAt = Date.now();
  // The crash never answers, so Page.crash would wait out the whole protocol timeout (3 minutes).
  await Promise.race([cdp.send('Page.crash').catch(() => {}), sleep(1500)]);
  ok('(the app was ended ' + (crashAt - C.at) + ' ms after she logged, inside the ' + DEBOUNCE + ' ms debounce)', crashAt - C.at < DEBOUNCE, { crashAt, loggedAt: C.at });
  ok('(and it really was ended: the renderer crashed, so no pagehide ran)', !!(await until(async () => crashes.length > 0, 5000)), crashes);
  // A crashed page can hold close() for the whole protocol timeout (3 minutes); it is gone already.
  await Promise.race([O.close().catch(() => {}), sleep(2000)]);
  O = await openPhone();
  ok('she opens Cubby again', await booted(O, 45000));
  ok('the feed reached the server', !!(await until(() => serverEvent(hid, C.id), 10000)), C.id);
  ok('and is on her phone', !!(await until(() => phoneEvent(O, C.id), 5000)));

  /* ================================================================================================ */
  console.log('\nD. nothing is left behind');
  ok('once everything has landed, no outbox is stored on her phone', !!(await until(async () => (await outboxes(O)).length === 0, 8000)), await outboxes(O));

  /* ================================================================================================ */
  console.log('\nE. the control: an entry with time for its push');
  await sleep(1000);
  const E = await editThenReload(O, 900, () => addEvent({ type: 'diaper', kind: 'dirty', time: Date.now(), notes: 'quick close E' }));
  ok('(the page went away ' + E.gone + ' ms after her edit, after the ' + DEBOUNCE + ' ms debounce)', E.gone > DEBOUNCE, E);
  ok('the entry reached the server', !!(await until(() => serverEvent(hid, E.out), 10000)), E.out);
  ok('and is on her phone', !!(await until(() => phoneEvent(O, E.out), 5000)));

  /* ================================================================================================ */
  ok('no page errors', errs.length === 0, errs.slice(0, 4));
  ok('nothing off localhost was ever answered', offHostAnswered.length === 0, [...new Set(offHostAnswered)]);

  await browser.close();
  serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('QUICK-CLOSE-EMU: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
