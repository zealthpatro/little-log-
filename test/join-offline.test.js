/* "Join the family" with no connection: an honest wait, and a join that still lands. November 2026
 * review, P2.
 *
 * What was wrong. A newcomer whose address has an invite waiting is asked first; she taps Join the
 * family, and the app shows its rotating loader while the join is written. With no connection the
 * write never gets an answer, so the loader turned forever: "Untangling the muslins…", "Almost
 * there…", round and round, with nothing she could do and nothing telling her why.
 *
 * What this pins down, with the REAL rules and the real Auth SDK (the circle-manage harness):
 *   A. Nina taps Join the family offline. The loader shows, and after about 8 seconds it gives way to
 *      the app's existing connectivity card, word for word (the one the boot shows when it cannot
 *      reach her Cubby), and the loader lines stop turning underneath it. Its button looks again
 *      without reloading the page (a reload here would strand the join half-written). Nothing has
 *      reached the server yet, and the invite is still there. When the connection comes back, the
 *      queued join lands by itself: she boots into Olive's family, the invite is spent, and her
 *      pointer to the family is saved.
 *   B. Paul taps Join the family online: he boots straight in and the card never appears, so the
 *      card is about the connection and not about joining.
 *
 *   node test/join-offline.test.js                     (rules = ./firestore.rules)
 *   RULES_FILE=/abs/old.rules node test/join-offline.test.js     the deploy window
 *   SHOT_DIR=/abs/dir node test/join-offline.test.js             also save screenshots
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
const FS_PORT = Number(process.env.FS_PORT) || 8737;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9737;
const WEB_PORT = Number(process.env.WEB_PORT) || 8738;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const EXEC_PROJECT = 'demo-cubby-joinoff';
const PAGE_PROJECT = 'little-log-a9caa'; // the id app/firebase-init.js gives the SDK; emulator only
const RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'firestore.rules');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = 'emulator-only-pw-joinoff';
/* The boot's own connectivity card, copied from store-firebase.js's onAuthStateChanged catch. The
   join must show exactly this and no new words. */
const CARD_TITLE = 'We can’t reach your Cubby';
const CARD_BODY = 'You look offline. Anything already saved on this phone is still here, safe. Try again once you have a connection.';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 500) : '')); }
  return !!c;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res) => {
  http.get(url, (r) => { r.resume(); res({ status: r.statusCode }); }).on('error', () => res({ status: 0 }));
});

/* ---------- outer phase: both emulators up, then re-run ourselves inside them ---------- */
if (!process.env.JOIN_OFFLINE_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-joinoff-'));
  fs.copyFileSync(RULES_FILE, path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { JOIN_OFFLINE_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
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
  while (Date.now() < stop) { v = await fn(); if (v) return v; await sleep(250); }
  return v;
}

/* ---------- inner phase ---------- */
(async () => {
  console.log('\njoining a family with no connection (' + (process.env.RULES_FILE ? 'rules: ' + RULES_FILE : 'firestore.rules') + ')\n');
  const serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
    { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(WEB_PORT) }) });
  // Never leave it behind: an orphan keeps the port and serves its tree to the next run.
  process.on('exit', () => { try { serveProc.kill(); } catch (e) {} });
  for (let i = 0; i < 40 && (await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200; i++) await sleep(250);
  const servedStore = await fetch(`http://localhost:${WEB_PORT}/app/store-firebase.js`).then((r) => r.text()).catch(() => '');
  ok('the static server serves THIS checkout\'s store-firebase.js, byte for byte', servedStore === fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8'));
  ok('(the card words above are the boot\'s own, still in store-firebase.js)', servedStore.includes("title: '" + CARD_TITLE + "'") && servedStore.includes("body: '" + CARD_BODY + "'"));

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const dl = require(path.join(ROOT, 'tools', 'gate_downloads.js'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', downloadBehavior: dl.downloadBehavior(),
    args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1'] });
  const errs = [];
  const offHostAnswered = [];
  const AUTH_PROJECT = process.env.GCLOUD_PROJECT || EXEC_PROJECT;
  const makeAccount = async (email) => {
    const r = await fetch(`http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${AUTH_PROJECT}/accounts`,
      { method: 'POST', headers: ADMIN, body: JSON.stringify({ email, password: PW, emailVerified: true }) });
    const j = await r.json().catch(() => ({}));
    if (!j.localId) throw new Error('could not make the emulator account for ' + email + ': ' + JSON.stringify(j).slice(0, 200));
    return j.localId;
  };
  const appUrl = () => `http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}`;
  /* Every change to the loader card is recorded with its time, from before the page's own scripts
     run, so "the card never appeared" is a measurement and not an absence of one. */
  const WATCH = () => {
    window.__cardSeen = []; window.__loaderLines = [];
    new MutationObserver(() => {
      const ov = document.getElementById('llAuthOv');
      const card = ov && ov.querySelector('.conn-card');
      if (card && !window.__cardSeen.length) window.__cardSeen.push(Date.now());
      const msg = document.getElementById('llAuthMsg');
      if (msg) { const t = msg.textContent; if (window.__loaderLines[window.__loaderLines.length - 1] !== t) window.__loaderLines.push(t); }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  };
  const person = async (email, viewport) => {
    const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(email + ': ' + e.message));
    page.on('response', (rs) => { try { const h = new URL(rs.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHostAnswered.push(h); } catch (e) {} });
    await page.setViewport(Object.assign({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, viewport || {}));
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]); // the Mac may be in dark mode
    await page.evaluateOnNewDocument(WATCH);
    await page.goto(appUrl(), { waitUntil: 'networkidle2', timeout: 45000 });
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
  const waitSheet = async (page, ms) => {
    try { await page.waitForFunction(() => { const s = document.getElementById('sheet'); return !!(s && s.classList.contains('show') && /invited/i.test(s.innerText)); }, { timeout: ms || 20000 }); return true; }
    catch (e) { return false; }
  };
  const tap = (page, label) => page.evaluate((l) => {
    const b = [...document.querySelectorAll('#sheet button')].find((x) => x.textContent.trim() === l);
    if (!b) return false; b.click(); return true;
  }, label);
  const screen = (page) => page.evaluate(() => {
    const ov = document.getElementById('llAuthOv');
    const card = ov && ov.querySelector('.conn-card');
    return { overlay: !!ov, loader: !!document.getElementById('llAuthMsg'), loaderText: (document.getElementById('llAuthMsg') || {}).textContent || '',
      card: !!card, title: card ? (card.querySelector('p') || {}).textContent : '', body: card ? (card.querySelector('span') || {}).textContent : '',
      button: card ? ((card.querySelector('.es-cta') || {}).textContent || '') : '', online: navigator.onLine };
  });
  const shot = async (page, name) => { if (process.env.SHOT_DIR) { await sleep(400); await page.screenshot({ path: path.join(process.env.SHOT_DIR, name + '.png') }); } };

  /* ---- the owner, and two invites ---- */
  console.log('the owner invites two people by email');
  const A = await person('olive@joinoff.test');
  ok('Olive boots into a family of her own', await booted(A));
  const a = await who(A);
  const inviteFor = (email, rel) => A.evaluate((email, rel) => {
    const u = window.LL.auth.currentUser;
    return Promise.all([
      window.LL.db.collection('invites').doc(email).set({ householdId: window.LL.householdId, role: 'caregiver', relationship: rel, name: '',
        invitedBy: u.uid, status: 'pending', fromEmail: u.email.toLowerCase(), invitedByName: 'Olive' }),
      window.LL.db.doc('households/' + window.LL.householdId).update(new firebase.firestore.FieldPath('pendingInvites', email), { name: '', relationship: rel, role: 'caregiver', at: Date.now() }),
    ]).then(() => 'ok', (e) => e && e.code);
  }, email, rel);
  ok('she invites Nina', (await inviteFor('nina@joinoff.test', 'Auntie')) === 'ok');
  ok('and Paul', (await inviteFor('paul@joinoff.test', 'Uncle')) === 'ok');

  /* ================================================================================================ */
  console.log('\nA. Nina taps Join the family with no connection');
  const N = await person('nina@joinoff.test');
  ok('she is asked first', await waitSheet(N));
  const nUid = (await who(N)).uid;
  await N.evaluate(() => { window.__samePage = 'yes'; });
  await N.setOfflineMode(true);
  ok('(she really is offline)', (await N.evaluate(() => navigator.onLine)) === false);
  const tappedAt = await N.evaluate(() => Date.now());
  ok('she taps Join the family', await tap(N, 'Join the family'));
  await sleep(1200);
  const s0 = await screen(N);
  ok('the loader shows while it tries', s0.loader && !s0.card, s0);
  await shot(N, 'join-offline-loader-390');

  const cardUp = await until(async () => { const s = await screen(N); return s.card ? s : null; }, 14000);
  const seenAt = await N.evaluate(() => window.__cardSeen[0] || null);
  ok('after a short wait the loader gives way to the connectivity card', !!cardUp, await screen(N));
  ok('about 8 seconds after the tap, not at once and not much later', !!seenAt && seenAt - tappedAt >= 7000 && seenAt - tappedAt <= 11000, { afterMs: seenAt && seenAt - tappedAt });
  ok('with the boot\'s own title', !!cardUp && cardUp.title === CARD_TITLE, cardUp && cardUp.title);
  ok('and the boot\'s own words', !!cardUp && cardUp.body === CARD_BODY, cardUp && cardUp.body);
  ok('and its own button', !!cardUp && cardUp.button === 'Try again', cardUp && cardUp.button);
  ok('the loader lines are gone, not drifting underneath', !!cardUp && !cardUp.loader, cardUp);
  const linesThen = await N.evaluate(() => window.__loaderLines.length);
  await sleep(4600);
  ok('and they stay stopped (no line changed in the next 4.6s)', (await N.evaluate(() => window.__loaderLines.length)) === linesThen);
  await shot(N, 'join-offline-card-390');
  await N.setViewport({ width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await sleep(300);
  const fit = await N.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cta: (() => { const b = document.querySelector('#llAuthOv .es-cta'); if (!b) return null; const r = b.getBoundingClientRect(); return { h: r.height, right: r.right }; })() }));
  ok('at 320px the card fits, and its button is a full touch target', fit.doc <= 0 && fit.cta && fit.cta.h >= 44 && fit.cta.right <= 320, fit);
  await shot(N, 'join-offline-card-320');
  if (process.env.SHOT_DIR) {   // the same card in Night, for a person to look at (it is the boot's own, themed)
    await N.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'));
    await shot(N, 'join-offline-card-night-320');
    await N.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await shot(N, 'join-offline-card-night-390');
    await N.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  }
  await N.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  const hhOff = await adminGet('households/' + a.hid);
  ok('nothing has reached the server: she is not in the family yet', !((hhOff && hhOff.members) || {})[nUid], hhOff && Object.keys(hhOff.members || {}));
  ok('and her invite is still there', !!(await adminGet('invites/nina@joinoff.test')));

  // Try again, still offline: it looks again, in this page.
  await N.evaluate(() => { const b = document.querySelector('#llAuthOv .es-cta'); if (b) b.click(); });
  await sleep(600);
  const s1 = await screen(N);
  ok('"Try again" offline goes back to waiting, in the same page (no reload)', s1.loader && !s1.card && (await N.evaluate(() => window.__samePage)) === 'yes', s1);

  console.log('\n   the connection comes back');
  await N.setOfflineMode(false);
  ok('she boots, without touching anything', await booted(N, 60000));
  const n = await who(N);
  ok('into Olive\'s family', n.hid === a.hid, { n, a });
  ok('in the same page she tapped in', (await N.evaluate(() => window.__samePage)) === 'yes');
  const hhOn = await until(async () => { const h = await adminGet('households/' + a.hid); return h && (h.members || {})[nUid] ? h : null; }, 10000);
  ok('the queued join reached the server', !!hhOn, hhOn && Object.keys(hhOn.members || {}));
  ok('her invite was spent by it', (await until(async () => (await adminGet('invites/nina@joinoff.test')) === null, 8000)) === true);
  const ptr = await until(async () => { const u = await adminGet('users/' + nUid); return u && u.householdId === a.hid ? u : null; }, 8000);
  ok('and her pointer to the family is saved, so the next launch opens it', !!ptr, await adminGet('users/' + nUid));
  ok('the card is gone', !(await screen(N)).card);

  /* ================================================================================================ */
  console.log('\nB. Paul taps Join the family online (the control)');
  const P = await person('paul@joinoff.test');
  ok('he is asked first', await waitSheet(P));
  ok('he taps Join the family', await tap(P, 'Join the family'));
  ok('he boots', await booted(P, 40000));
  const p = await who(P);
  ok('into Olive\'s family', p.hid === a.hid, { p, a });
  await sleep(9000);
  ok('and the connectivity card never appeared, before or after', (await P.evaluate(() => window.__cardSeen.length)) === 0);

  ok('no page errors on any phone', errs.length === 0, errs.slice(0, 4));
  ok('nothing off localhost was ever answered', offHostAnswered.length === 0, [...new Set(offHostAnswered)]);
  await browser.close();
  serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('JOIN-OFFLINE: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
