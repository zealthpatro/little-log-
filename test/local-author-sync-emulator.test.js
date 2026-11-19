/* An entry authored 'local' never syncs, and an owner's edit of a caregiver's entry is not refused.
 *
 * The REAL app/store-firebase.js client against the Firestore + Auth emulators and the real rules.
 * firestore.rules requires an events CREATE to carry authorId == the writer's uid, and makes authorId
 * immutable on update. Writers that stamp authorId themselves with myUid() (importCommit, setBirthWeight)
 * stamp the literal 'local' while nobody is signed in, and the sync layer let that 'local' win, so the
 * write was refused for ever (the denial toast, then one retry every 5 minutes).
 *
 *   A1 signed out: a birth weight (setBirthWeight) and an entry carrying authorId 'local'; she then signs
 *      in to a brand-new family (the sign-in migration): the server holds both, authored by her uid
 *   A2 signed in, household exists: an entry carrying authorId 'local' is pushed: the server holds it,
 *      authored by her uid
 *   B  a caregiver logs an entry; the owner edits it: the edit lands and the author stays the caregiver
 *   C  a caregiver edits her own entry whose local copy has no authorId: it lands, author unchanged
 *   D  an ordinary entry by a signed-in parent: the server holds it, authored by her uid
 *   E  a solo parent's first entry, made before any household exists: reaches the server once it does
 *
 *   node test/local-author-sync-emulator.test.js
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
const FS_PORT = Number(process.env.FS_PORT) || 8777;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9777;
const WEB_PORT = Number(process.env.WEB_PORT) || 8778;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const EXEC_PROJECT = 'demo-cubby-localauthor';
const PAGE_PROJECT = 'little-log-a9caa'; // the id app/firebase-init.js gives the SDK; emulator only
const RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'firestore.rules');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = 'emulator-only-pw-localauthor';

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
if (!process.env.LOCAL_AUTHOR_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-localauthor-'));
  fs.copyFileSync(RULES_FILE, path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { LOCAL_AUTHOR_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
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
/* Admin write of string fields at dotted paths (bypasses the rules): sets up a caregiver who is already in the circle. */
async function adminPatch(p, fields) {
  const mask = Object.keys(fields).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k.split('.').map((x) => '`' + x + '`').join('.'))).join('&');
  const body = { fields: {} };
  Object.keys(fields).forEach((k) => {
    const parts = k.split('.'); let at = body.fields;
    parts.slice(0, -1).forEach((s) => { at[s] = at[s] || { mapValue: { fields: {} } }; at = at[s].mapValue.fields; });
    at[parts[parts.length - 1]] = { stringValue: fields[k] };
  });
  const r = await fetch(FS_DOCS + p + '?' + mask, { method: 'PATCH', headers: ADMIN, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('admin patch ' + p + ': ' + (await r.text()).slice(0, 200));
}
async function until(fn, ms) {
  const stop = Date.now() + (ms || 10000);
  let v;
  while (Date.now() < stop) { v = await fn(); if (v) return v; await sleep(100); }
  return v;
}

/* ---------- inner phase ---------- */
(async () => {
  console.log('\nan entry authored local still syncs, and an owner can edit a caregiver\'s entry, real client, real rules (' + (process.env.RULES_FILE ? 'RULES_FILE=' + RULES_FILE : 'firestore.rules') + ')\n');
  const serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
    { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(WEB_PORT) }) });
  process.on('exit', () => { try { serveProc.kill(); } catch (e) {} });
  for (let i = 0; i < 40 && (await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200; i++) await sleep(250);
  const servedStore = await fetch(`http://localhost:${WEB_PORT}/app/store-firebase.js`).then((r) => r.text()).catch(() => '');
  ok('the static server serves THIS checkout\'s store-firebase.js, byte for byte', servedStore === fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8'));
  const servedIndex = await fetch(`http://localhost:${WEB_PORT}/app/index.html`).then((r) => r.text()).catch(() => '');
  ok('and THIS checkout\'s index.html', servedIndex === fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8'));

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const dl = require(path.join(ROOT, 'tools', 'gate_downloads.js'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', downloadBehavior: dl.downloadBehavior(),
    args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1'] });
  const errs = [], offHostAnswered = [];
  const AUTH_PROJECT = process.env.GCLOUD_PROJECT || EXEC_PROJECT;
  const appUrl = () => `http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}`;
  /* One browser context per phone: its own localStorage and IndexedDB, like a separate device. */
  const openPhone = async () => {
    const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('response', (rs) => { try { const h = new URL(rs.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHostAnswered.push(h); } catch (e) {} });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(appUrl(), { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForFunction(() => !!(window.LL && window.LL.auth && window.LL.auth.signInWithEmailAndPassword), { timeout: 20000 });
    return page;
  };
  const hookToasts = (page) => page.evaluate(() => { window.__toasts = []; const t = window.toast; window.toast = function (m) { window.__toasts.push(String(m)); return t && t.apply(this, arguments); }; });
  const toasts = (page) => page.evaluate(() => window.__toasts || []);
  const booted = async (page, ms) => {
    try {
      await page.waitForFunction(() => !!(window.LL && window.LL.householdId && typeof state !== 'undefined' && !document.getElementById('llAuthOv')), { timeout: ms || 40000 });
      return true;
    } catch (e) { return false; }
  };
  const makeAccount = async (email) => {
    const made = await fetch(`http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${AUTH_PROJECT}/accounts`,
      { method: 'POST', headers: ADMIN, body: JSON.stringify({ email, password: PW, emailVerified: true }) }).then((r) => r.json()).catch(() => ({}));
    if (!made.localId) throw new Error('could not make the emulator account: ' + JSON.stringify(made).slice(0, 200));
    return made.localId;
  };
  const signIn = (page, email) => page.evaluate((e, p) => window.LL.auth.signInWithEmailAndPassword(e, p).then(() => true), email, PW);
  const myUidOf = (page) => page.evaluate(() => window.LL.auth.currentUser.uid);
  const serverEvent = (hid, id) => adminGet('households/' + hid + '/events/' + id);
  const settle = async (hid, id, pred, ms) => { let e = null; await until(async () => { e = await serverEvent(hid, id); return e && pred(e); }, ms || 9000); return e; };
  const babyBlob = { id: 'bpip', name: 'Pip', birth: Date.now() - 20 * 86400000, sex: 'M', routines: [], doctors: [], allergies: [] };
  const withBaby = (page) => page.evaluate((b) => { state.babies = [b]; state.activeBabyId = b.id; }, babyBlob);

  /* ================================================================================================
     Setup: Olive (owner) makes a family; Cara is a caregiver already in the circle */
  console.log('setup: Olive makes a family, Cara is in the circle');
  const oliveUid = await makeAccount('olive@localauthor.test');
  const O = await openPhone(); await hookToasts(O);
  await signIn(O, 'olive@localauthor.test');
  ok('Olive boots into a family of her own', await booted(O));
  const hid = await O.evaluate(() => window.LL.householdId);
  await O.evaluate((b) => { state.babies = [b]; state.activeBabyId = b.id; persist(); }, babyBlob);
  ok('(the baby reached the server)', !!(await until(async () => ((((await adminGet('households/' + hid)) || {}).app || {}).babies || []).length === 1, 8000)));
  await O.evaluate(() => { const u = window.LL.auth.currentUser.uid; return window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + u + '.setupDone']: true, ['memberInfo.' + u + '.name']: 'Olive' }); });
  const caraUid = await makeAccount('cara@localauthor.test');
  await adminPatch('households/' + hid, { ['members.' + caraUid]: 'caregiver', ['memberInfo.' + caraUid + '.name']: 'Cara', ['memberInfo.' + caraUid + '.role']: 'caregiver', ['memberInfo.' + caraUid + '.setupDone']: 'true' });
  await adminPatch('users/' + caraUid, { householdId: hid });
  const Cp = await openPhone(); await hookToasts(Cp);
  await signIn(Cp, 'cara@localauthor.test');
  ok('Cara boots into Olive\'s family', await booted(Cp));
  ok('(Cara is in Olive\'s household)', (await Cp.evaluate(() => window.LL.householdId)) === hid);
  await sleep(3500); // the bear claims (2 s after a snapshot) settle before the cases

  /* ================================================================================================ */
  console.log('\nA1. signed out she logs a birth weight and an entry stamped local, then signs in to a new family');
  const P = await openPhone(); await hookToasts(P);
  const a1 = await P.evaluate((b) => {
    state.babies = [b]; state.activeBabyId = b.id;
    setBirthWeight(b, { weight: 3.3, wUnit: 'kg' });
    const id = addEvent({ type: 'diaper', kind: 'wet', time: Date.now() - 3600000, notes: 'A1 stamped local', authorId: 'local' });
    const bw = state.events.find((e) => e.birthWeight);
    return { id, bwId: bw && bw.id, bwAuthor: bw && bw.authorId };
  }, babyBlob);
  ok('(setBirthWeight stamped the literal local while she was signed out)', a1.bwAuthor === 'local', a1);
  await sleep(600);
  ok('(both are on her phone: little-log-v1 holds them, authored local)', await P.evaluate((a, b) => { const s = JSON.parse(localStorage.getItem('little-log-v1') || '{}'); const ev = s.events || []; return ev.some((e) => e.id === a && e.authorId === 'local') && ev.some((e) => e.id === b && e.authorId === 'local'); }, a1.id, a1.bwId));
  const annUid = await makeAccount('ann@localauthor.test');
  await signIn(P, 'ann@localauthor.test');
  ok('she signs in and boots into a new family', await booted(P, 45000), await P.evaluate(() => ({ overlay: (document.getElementById('llAuthOv') || {}).innerText, toasts: window.__toasts, hid: window.LL.householdId })));
  const hidP = await P.evaluate(() => window.LL.householdId);
  const sA = await settle(hidP, a1.id, () => true), sB = await settle(hidP, a1.bwId, () => true);
  ok('A1 the entry stamped local reached the server', !!sA, { hidP, id: a1.id, toasts: await toasts(P) });
  ok('A1 and it is authored by her uid', !!sA && sA.authorId === annUid, sA && sA.authorId);
  ok('A1 the birth weight reached the server', !!sB, { id: a1.bwId });
  ok('A1 and it is authored by her uid', !!sB && sB.authorId === annUid, sB && sB.authorId);

  /* ================================================================================================ */
  console.log('\nB. Cara logs an entry, Olive edits it');
  const bId = await Cp.evaluate(() => addEvent({ type: 'feed', method: 'bottle', amount: 60, time: Date.now() - 1800000, notes: 'B by Cara' }));
  const sB0 = await settle(hid, bId, (e) => e.authorId === caraUid);
  ok('(Cara\'s entry is on the server, authored by Cara)', !!sB0 && sB0.authorId === caraUid, sB0);
  ok('(Olive\'s phone has it)', !!(await until(() => O.evaluate((id) => (state.events || []).some((e) => e.id === id), bId), 8000)));
  await O.evaluate((id) => { const e = state.events.find((x) => x.id === id); e.notes = 'B edited by Olive'; e.editedBy = window.LL.auth.currentUser.uid; persist(); }, bId);
  const sB1 = await settle(hid, bId, (e) => e.notes === 'B edited by Olive');
  ok('B the owner\'s edit reached the server', !!sB1 && sB1.notes === 'B edited by Olive', { sB1, toasts: await toasts(O) });
  ok('B and the author is still Cara', !!sB1 && sB1.authorId === caraUid, sB1 && sB1.authorId);
  ok('B Olive was shown no denial toast', !(await toasts(O)).some((t) => /wasn.t allowed to save/.test(t)), await toasts(O));

  /* ================================================================================================ */
  console.log('\nB2. Cara logs an entry, Olive edits it from a copy that has lost its authorId');
  const b2Id = await Cp.evaluate(() => addEvent({ type: 'feed', method: 'bottle', amount: 65, time: Date.now() - 1700000, notes: 'B2 by Cara' }));
  await settle(hid, b2Id, (e) => e.authorId === caraUid);
  await until(() => O.evaluate((id) => (state.events || []).some((e) => e.id === id), b2Id), 8000);
  await O.evaluate(() => { window.__toasts.length = 0; });
  await O.evaluate((id) => { const e = state.events.find((x) => x.id === id); delete e.authorId; e.notes = 'B2 edited by Olive'; persist(); }, b2Id);
  const sB2 = await settle(hid, b2Id, (e) => e.notes === 'B2 edited by Olive');
  ok('B2 the owner\'s edit reached the server', !!sB2 && sB2.notes === 'B2 edited by Olive', { sB2, toasts: await toasts(O) });
  ok('B2 and the author is still Cara', !!sB2 && sB2.authorId === caraUid, sB2 && sB2.authorId);

  /* ================================================================================================ */
  console.log('\nC. Cara edits her own entry whose local copy has no authorId');
  const cId = await Cp.evaluate(() => addEvent({ type: 'feed', method: 'bottle', amount: 70, time: Date.now() - 900000, notes: 'C by Cara' }));
  await settle(hid, cId, (e) => e.authorId === caraUid);
  await Cp.evaluate((id) => { const e = state.events.find((x) => x.id === id); delete e.authorId; e.notes = 'C edited by Cara'; persist(); }, cId);
  const sC = await settle(hid, cId, (e) => e.notes === 'C edited by Cara');
  ok('C the edit reached the server', !!sC && sC.notes === 'C edited by Cara', { sC, toasts: await toasts(Cp) });
  ok('C and the author is still Cara', !!sC && sC.authorId === caraUid, sC && sC.authorId);

  /* ================================================================================================ */
  console.log('\nD. an ordinary entry by a signed-in parent');
  const dId = await O.evaluate(() => addEvent({ type: 'feed', method: 'bottle', amount: 80, time: Date.now(), notes: 'D ordinary' }));
  const sD = await settle(hid, dId, () => true);
  ok('D it reached the server, authored by Olive\'s uid', !!sD && sD.authorId === oliveUid, sD);

  /* ================================================================================================ */
  console.log('\nA2. signed in, household exists: an entry carrying authorId local is pushed');
  const a2 = await O.evaluate(() => { const id = 'a2' + uid(); state.events.push({ id, type: 'diaper', kind: 'dirty', time: Date.now(), babyId: state.activeBabyId, notes: 'A2 stamped local', authorId: 'local' }); persist(); return id; });
  const sA2 = await settle(hid, a2, () => true);
  ok('A2 the entry reached the server', !!sA2, { id: a2, toasts: await toasts(O) });
  ok('A2 and it is authored by Olive\'s uid', !!sA2 && sA2.authorId === oliveUid, sA2 && sA2.authorId);
  const a2Phone = await O.evaluate((id) => ({ inState: (state.events || []).some((e) => e.id === id), inStore: (JSON.parse(localStorage.getItem('little-log-v1') || '{}').events || []).some((e) => e.id === id) }), a2);
  ok('A2 the entry is still on her phone (in state.events; little-log-v1 is only written signed out, so it is reported, not judged)', a2Phone.inState, a2Phone);
  console.log('       (A2 phone after the push: ' + JSON.stringify(a2Phone) + ')');

  /* ================================================================================================ */
  console.log('\nR. a ritual ticked while myUid() is still local (the Firebase chain loads late)');
  const rId = await O.evaluate(() => {
    const b = activeBaby(); const list = ensureRoutines(b);
    list.push({ id: 'rR', title: 'Bottle', time: '07:00', evType: 'feed', done: {} });
    const real = myUid; myUid = function () { return 'local'; };
    try { toggleRoutine('rR'); } finally { myUid = real; }
    const e = state.events.find((x) => x.fromRoutine && x.authorId === 'local');
    return e && e.id;
  });
  ok('(the ritual stamped the literal local on its entry)', !!rId, rId);
  const sR = rId && await settle(hid, rId, () => true);
  ok('R the ritual entry reached the server', !!sR, { rId, toasts: await toasts(O) });
  ok('R and it is authored by Olive\'s uid', !!sR && sR.authorId === oliveUid, sR && sR.authorId);

  /* ================================================================================================ */
  console.log('\nE. a solo parent\'s first entry, made before any household exists');
  const Q = await openPhone(); await hookToasts(Q);
  const eId = await Q.evaluate((b) => { state.babies = [b]; state.activeBabyId = b.id; return addEvent({ type: 'sleep', time: Date.now() - 7200000, endTime: Date.now() - 3600000, notes: 'E first entry' }); }, babyBlob);
  await sleep(600);
  ok('(it is on her phone before she has a household)', await Q.evaluate((id) => (JSON.parse(localStorage.getItem('little-log-v1') || '{}').events || []).some((e) => e.id === id), eId));
  const bobUid = await makeAccount('bob@localauthor.test');
  await signIn(Q, 'bob@localauthor.test');
  ok('she signs in and boots into a new family', await booted(Q, 45000));
  const hidQ = await Q.evaluate(() => window.LL.householdId);
  const sE = await settle(hidQ, eId, () => true);
  ok('E the first entry reached the server', !!sE, { eId, toasts: await toasts(Q) });
  ok('E and it is authored by her uid', !!sE && sE.authorId === bobUid, sE && sE.authorId);

  /* ================================================================================================ */
  ok('no page errors', errs.length === 0, errs.slice(0, 4));
  ok('nothing off localhost was ever answered', offHostAnswered.length === 0, [...new Set(offHostAnswered)]);

  await browser.close();
  serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('LOCAL-AUTHOR-SYNC: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
