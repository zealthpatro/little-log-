/* The shared household blob keeps every edit, with two phones, the REAL rules and a real Firestore.
 *
 * Three data-integrity bugs found by the 2026-11-12 review, each of them silent:
 *
 *   R1 LOST UPDATE. A household snapshot that lands while this phone still owes the cloud an edit
 *      (the 350 ms push debounce, or a retry) used to overwrite every app.* key with the server's
 *      copy and then re-baseline, so the push found nothing to send. Her own memberInfo write in the
 *      same tick was enough to make a new medicine vanish. Section 1 stages each shape of it:
 *        A  a caregiver adds a medicine and her own circle entry is written in the same tick
 *        B  the owner starts a nap timer; 200 ms later a caregiver adds a medicine. The caregiver
 *           must keep her medicine AND see the owner's timer (she did not touch timers)
 *        C  both add a DIFFERENT medicine inside the window: both survive, on both phones and the server
 *        D  both edit the SAME medicine: the later phone's edit wins, nothing else on the list is lost
 *        E  the control: an edit made 400 ms after the snapshot has always been saved
 *        F  TWO of the owner's saves land inside ONE pending window of the caregiver's (she keeps
 *           typing, so her debounce keeps re-arming): the owner's second dose and her delete stand.
 *           Merged against the baseline from before the first, the caregiver's push put the first
 *           dose back and brought the deleted medicine back, on every phone (review A-V1)
 *        G  the same through a retry: her save fails once (staged), and the owner corrects a dose
 *           twice while she waits out the 8 s backoff
 *      Every case also checks that the snapshot really did land inside her pending window (otherwise
 *      the case proves nothing).
 *   R2 A LEGACY app.pregnancy BLOCKS EVERY SAVE. appBlobClean refuses any write that touches `app`
 *      while app.pregnancy is there. The owner's one-time move to her own journey doc must delete it,
 *      and only after the journey is safe on the server. Then the owner AND a caregiver can save.
 *        2  the move, the strip, and both saves
 *        2b idempotent: the key is back (a strip that never landed) and her own doc already exists,
 *           so only the strip is owed, and the stale copy never overwrites her journey
 *        2c her journey write is refused: nothing is stripped (the blob holds the only copy), and
 *           the next snapshot finishes the move once it can be saved
 *        2d the legacy copy names the CAREGIVER as its owner: the owner's phone leaves it alone, and
 *           her own phone moves it into HER private docs and strips it (review A-V4)
 *        2e the owner's move fails once (a staged 'unavailable' read), and the person the copy names
 *           joins the circle before the retry runs. The retry must not strip it: the skip used to drop
 *           the stashed copy, the retry then read "a legacy key with nothing in it" and deleted her
 *           journey and health from the blob without moving them anywhere (review A-V5)
 *   R3 A MEDICINE WITH NO babyId. normalizeLoadedState gave it subject.id = undefined, Firestore refuses
 *      undefined SYNCHRONOUSLY inside update(), and pushNow died with an unhandled rejection: no toast,
 *      no retry, and every later blob save from that phone died the same way. Two halves, proved apart:
 *        3a a synchronous refusal (staged with an undefined that has nothing to do with medicines) is
 *           treated like a rejected write: one toast, a retry with backoff, the baseline untouched
 *        3b the medicine with no babyId never produces undefined, so her saves land
 *
 * Harness: test/circle-manage.test.js's. ?authemu runs the real Auth SDK against the Auth emulator, so
 * every write carries a real token and the Firestore emulator enforces firestore.rules.
 *
 *   node test/blob-sync.test.js
 *   RULES_FILE=/path/to/live.rules node test/blob-sync.test.js     (the deploy window)
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
const FS_PORT = Number(process.env.FS_PORT) || 8757;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9757;
const WEB_PORT = Number(process.env.WEB_PORT) || 8758;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const EXEC_PROJECT = 'demo-cubby-blobsync';
const PAGE_PROJECT = 'little-log-a9caa'; // the id app/firebase-init.js gives the SDK; emulator only
const RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'firestore.rules');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = 'emulator-only-pw-blobsync';
const DEBOUNCE = 350; // scheduledPush's debounce in app/store-firebase.js

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
if (!process.env.BLOB_SYNC_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-blobsync-'));
  fs.copyFileSync(RULES_FILE, path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { BLOB_SYNC_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
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

/* ---------- emulator admin access (bypasses the rules; seeds and reads back) ---------- */
const FS_DOCS = `http://localhost:${FS_PORT}/v1/projects/${PAGE_PROJECT}/databases/(default)/documents/`;
const ADMIN = { 'content-type': 'application/json', authorization: 'Bearer owner' };
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  const fields = {}; Object.keys(v).forEach((k) => { fields[k] = toValue(v[k]); });
  return { mapValue: { fields } };
}
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
// Write ONE field path of the household's app blob, as a Bearer-owner admin (rules bypassed).
async function adminSetAppField(hid, key, value) {
  const body = { fields: { app: { mapValue: { fields: { [key]: toValue(value) } } } } };
  const r = await fetch(FS_DOCS + 'households/' + hid + '?updateMask.fieldPaths=app.' + key, { method: 'PATCH', headers: ADMIN, body: JSON.stringify(body) });
  if (r.status !== 200) throw new Error('seed app.' + key + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
// One field path of any document, as a Bearer-owner admin.
async function adminPatch(p, fieldPath, value) {
  const fields = {}; let cur = fields; const segs = fieldPath.split('.');
  segs.forEach((seg, i) => { if (i === segs.length - 1) cur[seg] = toValue(value); else { cur[seg] = { mapValue: { fields: {} } }; cur = cur[seg].mapValue.fields; } });
  const mask = segs.map((seg) => (/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(seg) ? seg : '`' + seg + '`')).join('.');
  const r = await fetch(FS_DOCS + p + '?updateMask.fieldPaths=' + encodeURIComponent(mask), { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields }) });
  if (r.status !== 200) throw new Error('patch ' + p + ' ' + fieldPath + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
async function adminDelete(p) {
  const r = await fetch(FS_DOCS + p, { method: 'DELETE', headers: ADMIN });
  if (r.status !== 200) throw new Error('delete ' + p + ' ' + r.status);
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
  console.log('\nthe shared household blob keeps every edit, two phones, real rules (' + (process.env.RULES_FILE ? 'RULES_FILE=' + RULES_FILE : 'firestore.rules') + ')\n');
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
  const errs = [], warns = [];
  const offHostAnswered = [];
  const AUTH_PROJECT = process.env.GCLOUD_PROJECT || EXEC_PROJECT;
  const makeAccount = async (email) => {
    const r = await fetch(`http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${AUTH_PROJECT}/accounts`,
      { method: 'POST', headers: ADMIN, body: JSON.stringify({ email, password: PW, emailVerified: true }) });
    const j = await r.json().catch(() => ({}));
    if (!j.localId) throw new Error('could not make the emulator account for ' + email + ': ' + JSON.stringify(j).slice(0, 200));
    return j.localId;
  };
  const appUrl = (q) => `http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}${q || ''}`;
  /* Before any of the page's own scripts: keep every toast, and every promise nobody caught. */
  const PROBES = () => {
    window.__toasts = []; window.__unhandled = [];
    /* Section 1G: the next blob save from this phone fails once, as a transient error would. Armed per
       page by window.__failNextHH; only an update that writes app.* fields is failed. */
    const arm = setInterval(() => {
      try {
        const P = window.firebase && firebase.firestore && firebase.firestore.DocumentReference && firebase.firestore.DocumentReference.prototype;
        if (!P || P.__failOnce) return;
        P.__failOnce = 1; clearInterval(arm);
        const up = P.update;
        P.update = function (upd) {
          if (window.__failNextHH && /^households\/[^/]+$/.test(this.path) && upd && Object.keys(upd).some((k) => k.indexOf('app.') === 0)) {
            window.__failNextHH = false; window.__failedAt = Date.now();
            return Promise.reject(Object.assign(new Error('staged transient failure'), { code: 'unavailable' }));
          }
          return up.apply(this, arguments);
        };
      } catch (e) {}
    }, 2);
    window.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason; window.__unhandled.push(String((r && (r.message || r.code)) || r));
    });
    document.addEventListener('DOMContentLoaded', () => {
      try { const t = window.toast; if (typeof t === 'function' && !t.__w) { const w = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; w.__w = 1; window.toast = w; } } catch (e) {}
    });
  };
  const person = async (email, query) => {
    const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(email + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'warn' || m.type() === 'warning' || m.type() === 'error') warns.push(email.split('@')[0] + ': ' + m.text().slice(0, 200)); });
    page.on('response', (rs) => { try { const h = new URL(rs.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHostAnswered.push(h); } catch (e) {} });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(PROBES);
    await page.goto(appUrl(query), { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForFunction(() => !!(window.LL && window.LL.auth && window.LL.auth.signInWithEmailAndPassword), { timeout: 20000 });
    await makeAccount(email);
    await page.evaluate((e, p) => window.LL.auth.signInWithEmailAndPassword(e, p).then(() => true), email, PW);
    return page;
  };
  const booted = async (page, ms) => {
    try {
      await page.waitForFunction(() => !!(window.LL && window.LL.householdId && typeof state !== 'undefined' && !document.getElementById('llAuthOv')), { timeout: ms || 40000 });
      return true;
    } catch (e) { return false; }
  };
  const who = (page) => page.evaluate(() => ({
    uid: window.LL && window.LL.auth && window.LL.auth.currentUser && window.LL.auth.currentUser.uid,
    hid: (window.LL && window.LL.householdId) || null, role: (window.LL && window.LL.role) || null,
  }));
  const toasts = (page) => page.evaluate(() => (window.__toasts || []).slice());
  const unhandled = (page) => page.evaluate(() => (window.__unhandled || []).slice());

  /* A phone's own view, and the server's. */
  const medsOf = (page) => page.evaluate(() => (state.meds || []).map((m) => m.id + ':' + (m.dose || '') + ':' + (m.name || '')));
  const idsOf = (list) => (list || []).map((s) => String(s).split(':')[0]);
  const serverApp = async (hid) => ((await adminGet('households/' + hid)) || {}).app || {};
  const serverMeds = async (hid) => ((await serverApp(hid)).meds || []).map((m) => m.id + ':' + (m.dose || '') + ':' + (m.name || ''));
  const has = (list, id) => idsOf(list).indexOf(id) >= 0;          // whole ids, never substrings
  const doseOf = (list, id) => { const r = (list || []).find((s) => String(s).split(':')[0] === id); return r ? r.split(':')[1] : null; };
  const nameOf = (list, id) => { const r = (list || []).find((s) => String(s).split(':')[0] === id); return r ? r.split(':').slice(2).join(':') : null; };

  /* Edits exactly as the app makes them: change state, then persist() (the store override). The time
     of the edit is stamped on the page's own clock so the window can be checked against it. */
  const addMed = (page, med) => page.evaluate((med) => {
    med.babyId = med.babyId === null ? undefined : (med.babyId || state.activeBabyId);
    if (med.babyId === undefined) delete med.babyId;
    med.createdAt = Date.now(); med.pattern = med.pattern || { type: 'asNeeded' };
    state.meds.push(med); window.__editAt = Date.now(); persist(); return window.__editAt;
  }, med);
  const editMed = (page, id, patch) => page.evaluate((id, patch) => {
    const m = state.meds.find((x) => x.id === id); if (!m) return null;
    Object.assign(m, patch); window.__editAt = Date.now(); persist(); return window.__editAt;
  }, id, patch);

  /* A second listener on the household doc, on the page itself: when did each version of the record
     reach this phone? Lets every case prove the snapshot landed INSIDE the debounce of her edit. */
  const watch = (page) => page.evaluate(() => {
    window.__hh = [];
    if (window.__hhUnsub) window.__hhUnsub();
    window.__hhUnsub = window.LL.db.doc('households/' + window.LL.householdId).onSnapshot((d) => {
      const a = (d.data() || {}).app || {};
      // Registered after the app's own listener on the same document, so this runs right after the app
      // has applied the snapshot: `seen*` is what her screen holds at that moment, before any push.
      window.__hh.push({ t: Date.now(), local: d.metadata.hasPendingWrites,
        meds: (a.meds || []).map((m) => m.id + ':' + (m.dose || '')), timers: JSON.stringify(a.timers || {}),
        seenMeds: (state.meds || []).map((m) => m.id + ':' + (m.dose || '')), seenTimers: JSON.stringify(state.timers || {}) });
    });
    return true;
  });
  // First REMOTE version that satisfies pred, and how long after her edit it reached her.
  const landedAfterEdit = (page, predSrc) => page.evaluate((src) => {
    const pred = new Function('s', 'return (' + src + ')(s)');
    const s = (window.__hh || []).find((x) => !x.local && pred(x));
    return s ? { dt: s.t - (window.__editAt || 0), seenMeds: s.seenMeds, seenTimers: s.seenTimers } : null;
  }, predSrc);
  const inWindow = (w) => !!w && w.dt >= 0 && w.dt < DEBOUNCE;
  /* A timing case only judges anything if the other phone's change really landed INSIDE her debounce.
     Under load it sometimes lands just after, which is the documented residual (two pushes of the same
     key racing at the server), not this fix. So the case is set up again, up to three times, until the
     window is hit; the window itself is still asserted, on the attempt that is judged. */
  const inWindowCase = async (label, run) => {
    let w = null;
    for (let i = 1; i <= 3; i++) {
      w = await run();
      if (inWindow(w)) break;
      if (i < 3) console.log('  ..   ' + label + ': the change landed outside her debounce (dt=' + (w && w.dt) + ' ms), setting the case up again');
    }
    ok('(the window was hit: ' + label + ')', inWindow(w), w);
    return w;
  };
  /* The legacy key has to be there when she OPENS Cubby, as it is in a real household: her phone is
     away while the admin writes it, then she comes back (signed in, the same browser). */
  const away = (page) => page.goto('about:blank');
  const back = async (page) => { await page.goto(appUrl(), { waitUntil: 'networkidle2', timeout: 45000 }); return booted(page, 45000); };

  /* ================================================================================================
     Setup: Olive (owner) and Nina (caregiver, joined by link) */
  console.log('setup: Olive makes a family, Nina joins by link');
  const O = await person('olive@blobsync.test');
  ok('Olive boots into a family of her own', await booted(O));
  const o = await who(O);
  const hid = o.hid;
  // The baby and her circle entry are two saves, a second apart: in ONE tick they are repro 1A itself.
  await O.evaluate(() => {
    state.babies = [{ id: 'bpip', name: 'Pip', birth: Date.now() - 40 * 86400000, sex: 'M', routines: [], doctors: [], allergies: [] }];
    state.activeBabyId = 'bpip'; persist();
  });
  ok('(the baby reached the server)', !!(await until(async () => ((await serverApp(hid)).babies || []).length === 1, 8000)));
  await O.evaluate(() => {
    const uid = window.LL.auth.currentUser.uid;
    return window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + uid + '.setupDone']: true, ['memberInfo.' + uid + '.name']: 'Olive' });
  });
  await sleep(1500);
  const link = await O.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Auntie' }));
  const N = await person('nina@blobsync.test', '&join=' + encodeURIComponent(link && link.token));
  ok('Nina boots into the same family', await booted(N, 45000));
  const n = await who(N);
  ok('as a caregiver', n.hid === hid && n.role === 'caregiver', n);
  await N.evaluate(() => {
    const uid = window.LL.auth.currentUser.uid;
    return window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + uid + '.name']: 'Nina', ['memberInfo.' + uid + '.setupDone']: true });
  });
  ok('both phones see the baby', !!(await until(async () => (await N.evaluate(() => (state.babies || []).length)) === 1 && (await O.evaluate(() => (state.babies || []).length)) === 1, 10000)));
  await N.evaluate(() => { state.activeBabyId = 'bpip'; });
  await sleep(3500); // the bear claims (2 s after a snapshot) settle before any timing-sensitive case
  await watch(O); await watch(N);

  /* Every case starts from a list the admin writes (rules bypassed) and BOTH phones have applied, so a
     case judges only itself, whatever the one before it lost. */
  const MED = (m) => Object.assign({ babyId: 'bpip', unit: 'ml', dose: '1', pattern: { type: 'asNeeded' }, createdAt: 1 }, m);
  const seedMeds = async (label, list) => {
    await adminSetAppField(hid, 'meds', list.map(MED));
    const want = list.map((m) => m.id).sort().join(',');
    const conv = await until(async () => idsOf(await medsOf(O)).sort().join(',') === want && idsOf(await medsOf(N)).sort().join(',') === want, 8000);
    ok('(' + label + ': both phones start from the same ' + list.length + ' medicine' + (list.length === 1 ? '' : 's') + ')', !!conv, { O: await medsOf(O), N: await medsOf(N) });
    await sleep(800);
  };

  /* ================================================================================================
     1. R1, the lost update */
  console.log('\n1A. Nina adds a medicine, and her own circle entry is written in the same tick');
  await seedMeds('1A', [{ id: 'mA0', name: 'Saline' }]);
  await N.evaluate(() => {
    state.meds.push({ id: 'mA', name: 'Calpol', dose: '2.5', unit: 'ml', babyId: 'bpip', pattern: { type: 'asNeeded' }, createdAt: Date.now() });
    window.__editAt = Date.now(); persist();
    const uid = window.LL.auth.currentUser.uid;
    return window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + uid + '.relationship']: 'Aunt' });
  });
  await sleep(2500);
  ok('her medicine is still on her phone', has(await medsOf(N), 'mA'), await medsOf(N));
  ok('it reached the server', has(await serverMeds(hid), 'mA'), await serverMeds(hid));
  ok('and Olive\'s phone', !!(await until(async () => has(await medsOf(O), 'mA'), 5000)), await medsOf(O));
  ok('and the one already there stayed', has(await serverMeds(hid), 'mA0'), await serverMeds(hid));

  console.log('\n1B. Olive starts a nap timer; 200 ms later Nina adds a medicine');
  const wB = await inWindowCase('Olive\'s timer reached Nina inside her debounce', async () => {
    await adminSetAppField(hid, 'timers', {});
    await seedMeds('1B', [{ id: 'mB0', name: 'Saline' }]);
    await N.evaluate(() => { window.__hh = []; }); // judge this attempt's snapshots only
    if (!(await O.evaluate(() => !(state.timers && state.timers.bpip && state.timers.bpip.sleep)) && await N.evaluate(() => !(state.timers && state.timers.bpip && state.timers.bpip.sleep)))) return null; // a timer still running: set up again
    await O.evaluate(() => { window.__editAt = Date.now(); state.timers = state.timers || {}; state.timers.bpip = { sleep: { start: Date.now() - 60000 } }; persist(); });
    await sleep(200);
    await addMed(N, { id: 'mB', name: 'Vitamin D', dose: '1', unit: 'drop' });
    if (!(await until(async () => !!(((await serverApp(hid)).timers || {}).bpip || {}).sleep, 8000))) return null; // her timer never reached the server: set up again
    await sleep(300);
    return landedAfterEdit(N, "(s) => /\"sleep\"/.test(s.timers)");
  });
  ok('the moment it arrives, Nina\'s screen has Olive\'s nap timer (she never touched timers)', !!wB && /"sleep"/.test(wB.seenTimers), wB);
  ok('and still has her own medicine, waiting to be saved', !!wB && wB.seenMeds.some((x) => x.split(':')[0] === 'mB'), wB);
  await sleep(2200);
  ok('Nina\'s medicine is still on her phone', has(await medsOf(N), 'mB'), await medsOf(N));
  ok('it reached the server', has(await serverMeds(hid), 'mB'), await serverMeds(hid));
  ok('and Olive\'s phone', !!(await until(async () => has(await medsOf(O), 'mB'), 5000)), await medsOf(O));
  ok('the timer is still running on the server (Nina\'s save did not stop it)', !!((((await serverApp(hid)).timers || {}).bpip || {}).sleep));
  ok('and on Nina\'s phone', await N.evaluate(() => !!(state.timers && state.timers.bpip && state.timers.bpip.sleep)));

  console.log('\n1C. both add a DIFFERENT medicine inside the window');
  const wC = await inWindowCase('Olive\'s medicine reached Nina inside her debounce', async () => {
    await seedMeds('1C', [{ id: 'mC0', name: 'Saline' }]);
    await N.evaluate(() => { window.__hh = []; }); // judge this attempt's snapshots only
    await addMed(O, { id: 'mC1', name: 'Iron', dose: '0.5', unit: 'ml' });
    await sleep(200);
    await addMed(N, { id: 'mC2', name: 'Probiotic', dose: '5', unit: 'drop' });
    await until(async () => has(await serverMeds(hid), 'mC1'), 5000);
    await sleep(300);
    return landedAfterEdit(N, "(s) => s.meds.some((x) => x.split(':')[0] === 'mC1')");
  });
  ok('the moment it arrives, Nina\'s screen has both medicines', !!wC && ['mC1', 'mC2'].every((id) => wC.seenMeds.some((x) => x.split(':')[0] === id)), wC);
  await sleep(3000);
  const sC = await serverMeds(hid), oC = await medsOf(O), nC = await medsOf(N);
  ok('the server has both', has(sC, 'mC1') && has(sC, 'mC2'), sC);
  ok('Olive\'s phone has both', has(oC, 'mC1') && has(oC, 'mC2'), oC);
  ok('Nina\'s phone has both', has(nC, 'mC1') && has(nC, 'mC2'), nC);
  ok('and the one already there stayed everywhere', has(sC, 'mC0') && has(oC, 'mC0') && has(nC, 'mC0'), sC);

  console.log('\n1D. both edit the SAME medicine inside the window');
  const wD = await inWindowCase('Olive\'s edit reached Nina inside her debounce', async () => {
    await seedMeds('1D', [{ id: 'mD', name: 'Calpol', dose: '2.5' }, { id: 'mD2', name: 'Iron' }, { id: 'mD3', name: 'Saline' }]);
    await N.evaluate(() => { window.__hh = []; }); // judge this attempt's snapshots only
    await O.evaluate(() => {
      state.meds.find((x) => x.id === 'mD').dose = '5';
      state.meds.find((x) => x.id === 'mD2').name = 'Iron drops';
      window.__editAt = Date.now(); persist();
    });
    await sleep(200);
    await editMed(N, 'mD', { dose: '7' });
    await until(async () => doseOf(await serverMeds(hid), 'mD') === '5', 5000);
    await sleep(300);
    return landedAfterEdit(N, "(s) => s.meds.indexOf('mD:5') >= 0");
  });
  ok('the moment it arrives, Nina\'s screen keeps her own 7', !!wD && wD.seenMeds.indexOf('mD:7') >= 0, wD);
  await sleep(3000);
  const sD = await serverMeds(hid), oD = await medsOf(O), nD = await medsOf(N);
  ok('the later phone wins the medicine both edited: 7, on the server', doseOf(sD, 'mD') === '7', sD);
  ok('and on both phones', doseOf(oD, 'mD') === '7' && doseOf(nD, 'mD') === '7', { O: oD, N: nD });
  ok('Olive\'s other edit, on a medicine Nina did not touch, is kept everywhere',
    nameOf(sD, 'mD2') === 'Iron drops' && nameOf(oD, 'mD2') === 'Iron drops' && nameOf(nD, 'mD2') === 'Iron drops', { S: sD, N: nD });
  ok('and nothing else on the list was lost', has(sD, 'mD3') && has(oD, 'mD3') && has(nD, 'mD3') && sD.length === 3, sD);

  console.log('\n1E. the control: Nina edits 400 ms after Olive\'s change has reached her');
  await seedMeds('1E', [{ id: 'mE0', name: 'Saline' }]);
  await addMed(O, { id: 'mE1', name: 'Saline', dose: '1', unit: 'drop' });
  ok('(Olive\'s medicine reached Nina)', !!(await until(async () => has(await medsOf(N), 'mE1'), 6000)));
  await sleep(400);
  await addMed(N, { id: 'mE2', name: 'Gripe water', dose: '2', unit: 'ml' });
  await sleep(2500);
  const sE = await serverMeds(hid);
  ok('both are saved, as they always were', has(sE, 'mE0') && has(sE, 'mE1') && has(sE, 'mE2'), sE);

  console.log('\n1F. TWO of Olive\'s saves reach Nina inside ONE pending window: Olive\'s later dose and her delete stand');
  /* Nina adds a medicine and keeps typing a note on it: every save re-arms her 350 ms debounce, so her
     push waits the whole 4 s. Olive corrects a dose (1 -> 2) and adds a medicine, then corrects the dose
     again (2 -> 3) and deletes that medicine. The window is proved from Nina's own listener: both of
     Olive's versions reached her as server snapshots that did not yet carry Nina's medicine, while she
     was still typing. */
  let wF = null;
  for (let i = 1; i <= 3; i++) {
    await seedMeds('1F', [{ id: 'mF', name: 'Calpol', dose: '1' }, { id: 'mF2', name: 'Saline' }]);
    await N.evaluate(() => { window.__hh = []; });
    await N.evaluate(() => {
      state.meds.push({ id: 'mFn', name: 'Gripe water', dose: '2', unit: 'ml', babyId: state.activeBabyId, pattern: { type: 'asNeeded' }, createdAt: Date.now(), notes: '' });
      window.__editAt = Date.now(); persist();
      let n = 0; window.__busyEnd = 0;
      window.__busy = setInterval(() => {
        const m = state.meds.find((x) => x.id === 'mFn'); if (m) m.notes = 'note ' + (++n);
        persist();
        if (n >= 20) { clearInterval(window.__busy); window.__busyEnd = Date.now(); }
      }, 200);
    });
    await sleep(100);
    await O.evaluate(() => {
      state.meds.find((x) => x.id === 'mF').dose = '2';
      state.meds.push({ id: 'mFy', name: 'Oops', dose: '1', unit: 'ml', babyId: state.activeBabyId, pattern: { type: 'asNeeded' }, createdAt: Date.now() });
      persist();
    });
    await until(async () => doseOf(await serverMeds(hid), 'mF') === '2', 4000);
    await sleep(700);
    await O.evaluate(() => { state.meds.find((x) => x.id === 'mF').dose = '3'; state.meds = state.meds.filter((x) => x.id !== 'mFy'); persist(); });
    await until(async () => doseOf(await serverMeds(hid), 'mF') === '3', 4000);
    await sleep(300);
    wF = await N.evaluate(() => {
      const first = (v) => (window.__hh || []).find((s) => !s.local && s.meds.indexOf(v) >= 0);
      const mine = (s) => s.meds.some((x) => x.split(':')[0] === 'mFn');
      const a = first('mF:2'), b = first('mF:3');
      return { v2: !!a && !mine(a), v3: !!b && !mine(b), typingAtV3: !!b && (!window.__busyEnd || b.t < window.__busyEnd), busyEnd: window.__busyEnd };
    });
    if (wF.v2 && wF.v3 && wF.typingAtV3) break;
    if (i < 3) {
      console.log('  ..   1F: the window was missed ' + JSON.stringify(wF) + ', setting the case up again');
      await until(async () => N.evaluate(() => !!window.__busyEnd), 6000);
      await sleep(2500);
    }
  }
  ok('(the window was hit: both of Olive\'s saves reached Nina while her own push was still waiting)', !!wF && wF.v2 && wF.v3 && wF.typingAtV3, wF);
  await until(async () => N.evaluate(() => !!window.__busyEnd), 8000);
  await until(async () => has(await serverMeds(hid), 'mFn'), 6000);
  await sleep(2500);
  const sF = await serverMeds(hid), oF = await medsOf(O), nF = await medsOf(N);
  ok('Nina\'s own medicine reached the server', has(sF, 'mFn'), sF);
  ok('Olive\'s LATEST dose (3) is on the server, not the 2 it replaced', doseOf(sF, 'mF') === '3', sF);
  ok('and on both phones', doseOf(oF, 'mF') === '3' && doseOf(nF, 'mF') === '3', { O: oF, N: nF });
  ok('the medicine Olive added and then deleted stays deleted on the server', !has(sF, 'mFy'), sF);
  ok('and on both phones', !has(oF, 'mFy') && !has(nF, 'mFy'), { O: oF, N: nF });
  ok('and nothing else on the list was lost', has(sF, 'mF2') && has(oF, 'mF2') && has(nF, 'mF2'), sF);

  console.log('\n1G. Nina\'s save fails once and waits out the retry; Olive corrects a dose twice meanwhile');
  await seedMeds('1G', [{ id: 'mG', name: 'Calpol', dose: '1' }]);
  await N.evaluate(() => { window.__failedAt = 0; window.__failNextHH = true; });
  await addMed(N, { id: 'mGn', name: 'Iron', dose: '1', unit: 'ml' });
  ok('(her first push failed, and she is waiting out the retry)', !!(await until(async () => N.evaluate(() => !!window.__failedAt), 4000)));
  await editMed(O, 'mG', { dose: '5' });
  await until(async () => doseOf(await serverMeds(hid), 'mG') === '5', 4000);
  await sleep(1200);
  await editMed(O, 'mG', { dose: '2.5' });
  await until(async () => doseOf(await serverMeds(hid), 'mG') === '2.5', 4000);
  const gG = await N.evaluate(() => Date.now() - window.__failedAt);
  const sG0 = await serverMeds(hid);
  ok('(both of Olive\'s corrections reached the server before Nina\'s retry)', gG < 7500 && !has(sG0, 'mGn') && doseOf(sG0, 'mG') === '2.5', { msSinceFailure: gG, server: sG0 });
  await until(async () => has(await serverMeds(hid), 'mGn'), 20000);
  await sleep(1500);
  const sG = await serverMeds(hid), oG = await medsOf(O), nG = await medsOf(N);
  ok('Nina\'s medicine reached the server on the retry', has(sG, 'mGn'), sG);
  ok('Olive\'s latest dose (2.5) is on the server, not the 5 it replaced', doseOf(sG, 'mG') === '2.5', sG);
  ok('and on both phones', doseOf(oG, 'mG') === '2.5' && doseOf(nG, 'mG') === '2.5', { O: oG, N: nG });

  /* ================================================================================================
     3. R3, a write Firestore refuses synchronously, and a medicine with no babyId */
  console.log('\n3a. a synchronous refusal inside update() is handled like a rejected write');
  const t0 = (await toasts(O)).length, u0 = (await unhandled(O)).length;
  await O.evaluate(() => { state.den = Object.assign({}, state.den || {}, { probe: { at: 1, oops: undefined } }); persist(); });
  await sleep(1200);
  await O.evaluate(() => { state.den.probe.at = 2; persist(); }); // a second save while it is still refused
  await sleep(1200);
  const u3a = (await unhandled(O)).slice(u0);
  ok('nothing is left as an unhandled rejection', !u3a.some((m) => /unsupported field value|invalid data|undefined/i.test(m)), u3a);
  const t3a = (await toasts(O)).slice(t0).filter((m) => /didn.t sync just now|wasn.t allowed|look offline/i.test(m));
  ok('Olive is told once, not on every save', t3a.length === 1, t3a);
  await O.evaluate(() => { delete state.den.probe.oops; }); // no persist(): only the retry can carry it now
  const retried = await until(async () => ((((await serverApp(hid)).den || {}).probe || {}).at) === 2, 20000); // two refusals: 8 s, then 16 s
  ok('the retry (with backoff, baseline untouched) saves it once it can be saved', !!retried, (await serverApp(hid)).den);
  if (!retried) { await O.evaluate(() => persist()); await sleep(1500); } // leave the phone saving, so 3b judges 3b alone

  console.log('\n3b. a medicine with no babyId does not stop the saves that follow it');
  await seedMeds('3b', [{ id: 'm3' , name: 'Saline' }]);
  await adminSetAppField(hid, 'meds', [MED({ id: 'm3', name: 'Saline' }), { id: 'mNoBaby', name: 'Old cod liver oil', dose: '1', unit: 'ml', pattern: { type: 'asNeeded' } }]);
  ok('(both phones have the medicine with no babyId)', !!(await until(async () => has(await medsOf(O), 'mNoBaby') && has(await medsOf(N), 'mNoBaby'), 6000)));
  await sleep(800);
  const u3b = (await unhandled(O)).length;
  await addMed(O, { id: 'mR3', name: 'Ibuprofen', dose: '2.5', unit: 'ml' });
  await sleep(2500);
  ok('Olive\'s next medicine reaches the server', has(await serverMeds(hid), 'mR3'), await serverMeds(hid));
  await O.evaluate(() => { (state.illnesses = state.illnesses || []).push({ id: 'ill3', babyId: 'bpip', name: 'Cold', startedAt: Date.now(), endedAt: null, notes: '', by: window.LL.auth.currentUser.uid }); persist(); });
  await sleep(2500);
  ok('and so does the save after it', ((await serverApp(hid)).illnesses || []).some((x) => x.id === 'ill3'), (await serverApp(hid)).illnesses);
  ok('no write died unhandled on her phone', !(await unhandled(O)).slice(u3b).length, (await unhandled(O)).slice(u3b));
  const noBaby = ((await serverApp(hid)).meds || []).find((m) => m.id === 'mNoBaby');
  ok('the medicine with no babyId is still there, untouched in substance', !!noBaby && noBaby.name === 'Old cod liver oil', noBaby);
  ok('Nina, a caregiver, can still save too', await (async () => {
    await addMed(N, { id: 'mR3n', name: 'Teething gel', dose: '1', unit: 'dab' });
    return !!(await until(async () => has(await serverMeds(hid), 'mR3n'), 5000));
  })(), await serverMeds(hid));
  // Leave the record clean for section 2.
  await seedMeds('2', [{ id: 'm2', name: 'Saline' }]);

  /* ================================================================================================
     2. R2, a legacy app.pregnancy */
  console.log('\n2. a legacy pregnancy in the shared blob is moved to Olive\'s own doc, and then everyone can save');
  const due = Date.now() + 90 * 86400000;
  await away(O);
  await adminSetAppField(hid, 'pregnancy', { stage: 'pregnant', dueDate: due, lmp: due - 280 * 86400000, weights: [{ id: 'w1', at: Date.now() - 86400000, kg: 61.5, unit: 'kg' }] });
  ok('(the legacy key is on the server)', !!(await serverApp(hid)).pregnancy);
  ok('Olive opens Cubby again', await back(O));
  const journey = await until(async () => { const j = await adminGet('households/' + hid + '/pregnancy/' + o.uid); return j && j.data && j.data.dueDate ? j : null; }, 15000);
  ok('her journey is in her own doc', !!journey && journey.data.dueDate === due && journey.data.stage === 'pregnant', journey);
  const health = await until(async () => { const h = await adminGet('households/' + hid + '/mhealth/' + o.uid + '/cat/health'); return h && h.data && (h.data.weights || []).length ? h : null; }, 10000);
  if (!ok('her weights are in her private health doc', !!health && health.data.weights[0].kg === 61.5, health)) {
    // Every input this depends on, printed rather than guessed at.
    const docs = await fetch(FS_DOCS + 'households/' + hid + '/mhealth/' + o.uid + '/cat', { headers: ADMIN }).then((r) => r.json()).catch(() => ({}));
    console.log('       mhealth docs: ' + JSON.stringify((docs.documents || []).map((d) => [d.name.split('/').pop(), fromValue({ mapValue: { fields: d.fields || {} } })])).slice(0, 900));
    console.log('       her phone: ' + JSON.stringify(await O.evaluate(() => ({ preg: state.pregnancy && Object.keys(state.pregnancy), weights: state.pregnancy && state.pregnancy.weights }))).slice(0, 400));
    console.log('       warnings: ' + JSON.stringify(warns.slice(-12)).slice(0, 1500));
  }
  const stripped = await until(async () => !('pregnancy' in (await serverApp(hid))), 10000);
  if (!ok('and the shared blob no longer carries it', !!stripped, Object.keys(await serverApp(hid)))) {
    console.log('       warnings: ' + JSON.stringify(warns.filter((w) => !/deprecated|404/.test(w)).slice(-10)).slice(0, 2500));
  }
  await sleep(1000);
  await addMed(O, { id: 'mP1', name: 'Folic acid', dose: '1', unit: 'tab' });
  ok('Olive can save to the blob', !!(await until(async () => has(await serverMeds(hid), 'mP1'), 6000)), await serverMeds(hid));
  await addMed(N, { id: 'mP2', name: 'Calamine', dose: '1', unit: 'dab' });
  ok('and so can Nina', !!(await until(async () => has(await serverMeds(hid), 'mP2'), 6000)), await serverMeds(hid));

  console.log('\n2b. idempotent: the legacy key comes back (a strip that never landed) and her own doc already exists');
  const dueOld = due - 30 * 86400000;
  await away(O);
  await adminSetAppField(hid, 'pregnancy', { stage: 'pregnant', dueDate: dueOld });
  await adminSetAppField(hid, 'maternalHealth', { note: 'legacy' });
  ok('Olive opens Cubby again', await back(O));
  const stripped2 = await until(async () => { const a = await serverApp(hid); return !('pregnancy' in a) && !('maternalHealth' in a); }, 12000);
  ok('every legacy key present is deleted', !!stripped2, Object.keys(await serverApp(hid)));
  const j2 = await adminGet('households/' + hid + '/pregnancy/' + o.uid);
  ok('and her own journey is NOT overwritten by the stale copy', !!j2 && j2.data.dueDate === due, j2 && j2.data);
  await sleep(1000);
  await addMed(N, { id: 'mP3', name: 'Nappy cream', dose: '1', unit: 'dab' });
  ok('Nina can still save', !!(await until(async () => has(await serverMeds(hid), 'mP3'), 6000)), await serverMeds(hid));

  console.log('\n2c. her journey cannot be saved: the legacy copy is NOT stripped, and the move finishes later');
  /* The journey write is refused in the page (the one thing staged here); whether it reached the
     server is still read from the real emulator, which is what the strip has to wait for. */
  await O.evaluateOnNewDocument(() => {
    const t = setInterval(() => {
      try {
        const P = window.firebase && firebase.firestore && firebase.firestore.DocumentReference && firebase.firestore.DocumentReference.prototype;
        if (!P || P.__staged) return;
        const set = P.set; P.__staged = 1; clearInterval(t);
        P.set = function () {
          if (/\/pregnancy\//.test(this.path) && sessionStorage.getItem('cubby-test-refuse-journey'))
            return Promise.reject(Object.assign(new Error('staged: the journey write is refused'), { code: 'permission-denied' }));
          return set.apply(this, arguments);
        };
      } catch (e) {}
    }, 2);
  });
  await O.evaluate(() => sessionStorage.setItem('cubby-test-refuse-journey', '1'));
  await away(O);
  await adminDelete('households/' + hid + '/pregnancy/' + o.uid);
  const due3 = Date.now() + 200 * 86400000;
  await adminSetAppField(hid, 'pregnancy', { stage: 'pregnant', dueDate: due3 });
  ok('Olive opens Cubby again', await back(O));
  await sleep(6000);
  ok('(her journey really could not be saved)', (await adminGet('households/' + hid + '/pregnancy/' + o.uid)) === null);
  const legacyKept = await serverApp(hid);
  ok('so the shared blob still holds the only copy: nothing was stripped', !!legacyKept.pregnancy && legacyKept.pregnancy.dueDate === due3, Object.keys(legacyKept));
  await O.evaluate(() => sessionStorage.removeItem('cubby-test-refuse-journey'));
  await adminPatch('households/' + hid, 'memberInfo.' + o.uid + '.name', 'Olive B'); // any later snapshot
  const j3 = await until(async () => { const j = await adminGet('households/' + hid + '/pregnancy/' + o.uid); return j && j.data && j.data.dueDate === due3 ? j : null; }, 15000);
  ok('once it can be saved, the next snapshot finishes the move: her journey is in her own doc', !!j3, j3);
  ok('and then the legacy copy goes', !!(await until(async () => !('pregnancy' in (await serverApp(hid))), 10000)), Object.keys(await serverApp(hid)));
  await sleep(800);
  await addMed(N, { id: 'mP4', name: 'Arnica', dose: '1', unit: 'dab' });
  ok('and Nina can save again', !!(await until(async () => has(await serverMeds(hid), 'mP4'), 6000)), await serverMeds(hid));

  console.log('\n2d. the legacy copy names NINA as its owner: only her phone moves it, into HER docs');
  /* The move lands a journey in the PRIVATE docs of whoever runs it. Run by Olive's phone, Nina's own
     pregnancy and care team sat in Olive's private health, unreadable by Nina, and the strip deleted
     the last copy Nina could read. A journey another member holds live on a phone stops any move
     there, so Olive's journey from 2c goes first. */
  await adminDelete('households/' + hid + '/pregnancy/' + o.uid);
  ok('(neither phone holds a journey any more)', !!(await until(async () => (await N.evaluate(() => !(state.pregnancy && state.pregnancy.ownerUid))) && (await O.evaluate(() => !(state.pregnancy && state.pregnancy.ownerUid))), 8000)));
  await away(N); await away(O);
  const due4 = Date.now() + 150 * 86400000;
  await adminSetAppField(hid, 'pregnancy', { ownerUid: n.uid, stage: 'pregnant', dueDate: due4, careTeam: [{ id: 'ct4', name: 'Midwife Rae' }] });
  ok('Olive opens Cubby again', await back(O));
  await sleep(4000);
  await adminPatch('households/' + hid, 'memberInfo.' + o.uid + '.name', 'Olive C'); // a later snapshot: every chance to move it
  await sleep(5000);
  const oDoc = await adminGet('households/' + hid + '/pregnancy/' + o.uid);
  ok('Olive\'s phone does not move it into Olive\'s journey doc', oDoc === null, oDoc);
  const oCare = await adminGet('households/' + hid + '/mhealth/' + o.uid + '/cat/careteam');
  ok('nor Nina\'s care team into Olive\'s private health', !JSON.stringify(oCare || {}).includes('Midwife Rae'), oCare);
  const kept4 = await serverApp(hid);
  ok('and does not strip it: the shared copy is still the only one', !!kept4.pregnancy && kept4.pregnancy.dueDate === due4, Object.keys(kept4));
  ok('Nina opens Cubby again', await back(N));
  const j4 = await until(async () => { const j = await adminGet('households/' + hid + '/pregnancy/' + n.uid); return j && j.data && j.data.dueDate === due4 ? j : null; }, 15000);
  ok('her own phone moves it into HER journey doc, though she is not an owner', !!j4, j4);
  ok('shared with the circle that could already see it (Olive)', !!j4 && JSON.stringify(j4.sharedWith) === JSON.stringify([o.uid]), j4 && j4.sharedWith);
  ok('the journey doc carries no health fields', !!j4 && !('careTeam' in j4.data), j4 && Object.keys(j4.data));
  const nCare = await until(async () => { const c = await adminGet('households/' + hid + '/mhealth/' + n.uid + '/cat/careteam'); return c && c.data && (c.data.careTeam || []).length ? c : null; }, 10000);
  ok('her care team is in HER private health doc, shared with nobody', !!nCare && nCare.data.careTeam[0].name === 'Midwife Rae' && (nCare.sharedWith || []).length === 0, nCare);
  ok('and then the shared copy goes', !!(await until(async () => !('pregnancy' in (await serverApp(hid))), 10000)), Object.keys(await serverApp(hid)));
  const peek = await O.evaluate((uid) => window.LL.db.doc('households/' + window.LL.householdId + '/mhealth/' + uid + '/cat/careteam').get().then(() => 'READ', (e) => e.code), n.uid);
  ok('Olive cannot read Nina\'s moved care team', peek === 'permission-denied', peek);
  await sleep(800);
  await addMed(O, { id: 'mP5', name: 'Gaviscon', dose: '1', unit: 'tab' });
  ok('Olive can save to the blob', !!(await until(async () => has(await serverMeds(hid), 'mP5'), 6000)), await serverMeds(hid));
  await addMed(N, { id: 'mP6', name: 'Lanolin', dose: '1', unit: 'dab' });
  ok('and so can Nina', !!(await until(async () => has(await serverMeds(hid), 'mP6'), 6000)), await serverMeds(hid));

  console.log('\n2e. the owner\'s move fails once, the person the copy names joins before the retry: nothing is stripped unmoved');
  /* The exact sequence of review A-V5: a failed move (the owner's, since the person named is not in the
     circle yet) leaves a retry waiting; a snapshot then shows that person in the circle, so it is no
     longer this phone's move and the check skips; then the retry runs. Nina's journey from 2d goes
     first (a journey another member holds live on a phone stops any move there), and Nina's phone is
     away, so only Olive's phone is in play. */
  await adminDelete('households/' + hid + '/pregnancy/' + n.uid);
  ok('(Olive\'s phone holds no journey any more)', !!(await until(async () => O.evaluate(() => !(state.pregnancy && state.pregnancy.ownerUid)), 8000)));
  const xUid = await makeAccount('xena@blobsync.test'); // the carrier the copy names; not in the circle yet
  await O.evaluateOnNewDocument(() => {
    const t = setInterval(() => {
      try {
        const P = window.firebase && firebase.firestore && firebase.firestore.DocumentReference && firebase.firestore.DocumentReference.prototype;
        if (!P || P.__stagedGet) return;
        const g = P.get; P.__stagedGet = 1; clearInterval(t);
        P.get = function () {
          if (/\/(pregnancy|mhealth)\//.test(this.path) && sessionStorage.getItem('cubby-test-fail-preg-read')) {
            window.__pregReadFailedAt = window.__pregReadFailedAt || Date.now();
            return Promise.reject(Object.assign(new Error('staged: the server read fails once'), { code: 'unavailable' }));
          }
          return g.apply(this, arguments);
        };
      } catch (e) {}
    }, 2);
  });
  await O.evaluate(() => sessionStorage.setItem('cubby-test-fail-preg-read', '1'));
  await away(N); await away(O);
  const due5 = Date.now() + 120 * 86400000;
  await adminSetAppField(hid, 'pregnancy', { ownerUid: xUid, stage: 'pregnant', dueDate: due5,
    bp: [{ id: 'bp5', at: Date.now() - 3600000, sys: 118, dia: 76 }], careTeam: [{ id: 'ct5', name: 'Midwife Ada' }] });
  ok('Olive opens Cubby again', await back(O));
  const failedAt = await until(() => O.evaluate(() => window.__pregReadFailedAt || 0), 10000);
  ok('(her phone\'s move failed on the staged read, so a retry is waiting)', !!failedAt);
  ok('(nothing is stripped yet)', 'pregnancy' in (await serverApp(hid)), Object.keys(await serverApp(hid)));
  await adminPatch('households/' + hid, 'members.' + xUid, 'caregiver');
  const seenIn = await until(() => O.evaluate((x) => ((window.LL.members || {})[x] === 'caregiver' ? Date.now() - window.__pregReadFailedAt : 0), xUid), 4000);
  ok('(her phone saw the person the copy names join ' + seenIn + ' ms after the failure, before the 5 s retry)', seenIn > 0 && seenIn < 4500, seenIn);
  await O.evaluate(() => sessionStorage.removeItem('cubby-test-fail-preg-read')); // the retry's read can now succeed
  await sleep(10000); // the retry runs 5 s after the failure
  const kept5 = await serverApp(hid);
  ok('the retry does not strip it: the shared copy is still there for her own phone to move', !!kept5.pregnancy && kept5.pregnancy.dueDate === due5, Object.keys(kept5));
  ok('with her blood pressure and care team in it', !!kept5.pregnancy && (kept5.pregnancy.bp || []).length === 1 && (kept5.pregnancy.careTeam || []).length === 1, kept5.pregnancy);
  const oDoc5 = await adminGet('households/' + hid + '/pregnancy/' + o.uid);
  ok('and nothing went into Olive\'s journey doc', oDoc5 === null, oDoc5);
  const oHealth5 = await adminGet('households/' + hid + '/mhealth/' + o.uid + '/cat/health');
  ok('nor into Olive\'s private health', !JSON.stringify(oHealth5 || {}).includes('"sys":118'), oHealth5);
  const xDoc5 = await adminGet('households/' + hid + '/pregnancy/' + xUid);
  ok('her due date and blood pressure still exist somewhere (the shared copy, or a journey doc)', (!!kept5.pregnancy && kept5.pregnancy.dueDate === due5 && JSON.stringify(kept5.pregnancy).includes('"sys":118'))
    || (!!xDoc5 && xDoc5.data && xDoc5.data.dueDate === due5) || (!!oDoc5 && oDoc5.data && oDoc5.data.dueDate === due5), { app: Object.keys(kept5), xDoc5, oDoc5 });

  /* ================================================================================================ */
  ok('no page errors on either phone', errs.length === 0, errs.slice(0, 4));
  ok('nothing off localhost was ever answered', offHostAnswered.length === 0, [...new Set(offHostAnswered)]);

  await browser.close();
  serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('BLOB-SYNC: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
