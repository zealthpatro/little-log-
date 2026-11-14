/* Looking after a family circle, end to end, with the REAL rules enforced. November 2026 review
 * findings joins-1 (NP-3), joins-4, everyday-1, -2, -3, -4, -6 and -7.
 *
 * What each section pins down, in one line:
 *   A. Remove and Cancel invite are tapped with a REAL mouse at 390px, from the Family & sharing
 *      sheet, and the confirm opens ON TOP of that sheet (it used to open behind it, so the tap
 *      looked like nothing). Removing someone also cancels every unused link, because every member
 *      can read the live link tokens: a removed member must not walk back in with one she saw.
 *   B. An email invite made offline shows in the owner's circle after a relaunch, a removal made
 *      offline reaches the server after a relaunch (B3), and an invite
 *      the rules refuse leaves no "Invited, waiting" row behind.
 *   C. An email invite into a family that has closed is thrown away when the join is refused, so
 *      it is not offered again on every launch.
 *   D. An owner who deletes her account leaves a co-owner in charge rather than promoting a
 *      caregiver over her, and the app's own "Papa Bear" counts as a parent when choosing an heir.
 *   E. The last one out finishes deleting her account on a phone whose clock is 25 days slow.
 *   F. "You're no longer in this family" and "We could not find your invite" are drawn on top of
 *      any open sheet, and their pink button's text passes 4.5:1.
 *
 * The harness is test/invite-consent.test.js's: ?authemu runs the real Firebase Auth SDK against the
 * Auth emulator, so every write carries a real (emulator) token and the Firestore emulator enforces
 * firestore.rules. Accounts are made verified through the emulator's admin endpoint, like every real
 * sign-in. Chrome has downloads redirected (tools/gate_downloads.js) and every host but localhost
 * unresolvable.
 *
 *   node test/circle-manage.test.js                     (rules = ./firestore.rules)
 *   RULES_FILE=/tmp/live.rules node test/circle-manage.test.js
 *       the deploy window: this client against the rules that are live now. Sections whose answer
 *       depends on the new rules (C, and E's 30 days) are checked the way those rules allow.
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
const FS_PORT = Number(process.env.FS_PORT) || 8727;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9727;
const WEB_PORT = Number(process.env.WEB_PORT) || 8728;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const EXEC_PROJECT = 'demo-cubby-circle';
const PAGE_PROJECT = 'little-log-a9caa'; // the id app/firebase-init.js gives the SDK; emulator only
const RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'firestore.rules');
const OLD_MODE = !!process.env.RULES_FILE;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = 'emulator-only-pw-circle';
const DAY = 86400000;

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
if (!process.env.CIRCLE_MANAGE_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-circle-'));
  fs.copyFileSync(RULES_FILE, path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { CIRCLE_MANAGE_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
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
  if (v instanceof Date) return { timestampValue: v.toISOString() };
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
async function adminSet(p, data) {
  const r = await fetch(FS_DOCS + p, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields: toValue(data).mapValue.fields }) });
  if (r.status !== 200) throw new Error('seed ' + p + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
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
  console.log('\nlooking after a family circle, with the real rules (' + (OLD_MODE ? 'LIVE rules: ' + RULES_FILE : 'firestore.rules') + ')\n');
  const serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
    { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(WEB_PORT) }) });
  for (let i = 0; i < 40 && (await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200; i++) await sleep(250);
  const servedStore = await fetch(`http://localhost:${WEB_PORT}/app/store-firebase.js`).then((r) => r.text()).catch(() => '');
  ok('the static server serves THIS checkout\'s store-firebase.js, byte for byte', servedStore === fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8'));

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const dl = require(path.join(ROOT, 'tools', 'gate_downloads.js'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', downloadBehavior: dl.downloadBehavior(),
    args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1'] });
  const errs = [];
  const offHost = [], offHostAnswered = [];
  const AUTH_PROJECT = process.env.GCLOUD_PROJECT || EXEC_PROJECT;
  const makeAccount = async (email, uid) => {
    const body = { email, password: PW, emailVerified: true };
    if (uid) body.localId = uid;
    const r = await fetch(`http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${AUTH_PROJECT}/accounts`,
      { method: 'POST', headers: ADMIN, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!j.localId) throw new Error('could not make the emulator account for ' + email + ': ' + JSON.stringify(j).slice(0, 200));
    return j.localId;
  };
  const appUrl = (q) => `http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}${q || ''}`;
  const wire = (page, email) => {
    page.on('pageerror', (e) => errs.push(email + ': ' + e.message));
    page.on('request', (rq) => { try { const h = new URL(rq.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHost.push(h); } catch (e) {} });
    page.on('response', (rs) => { try { const h = new URL(rs.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHostAnswered.push(h); } catch (e) {} });
  };
  // The app calls window.toast; keep a copy of every message, from before its own scripts run.
  const TOASTS = () => {
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => {
      try { const t = window.toast; if (typeof t === 'function' && !t.__w) { const w = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; w.__w = 1; window.toast = w; } } catch (e) {}
    });
  };
  /* opts: query, before (page fn run after load, before sign-in), uid (fixed uid), skewMs (the
     phone's clock, set before any of the page's own scripts run), ctx (reuse a context) */
  const person = async (email, opts) => {
    opts = opts || {};
    const ctx = opts.ctx || await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const page = await ctx.newPage();
    wire(page, email);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    if (opts.skewMs) {
      await page.evaluateOnNewDocument((off) => {
        const D = Date;
        function FD(...a) { if (!(this instanceof FD)) return D(); return a.length ? new D(...a) : new D(D.now() + off); }
        FD.prototype = D.prototype; FD.now = () => D.now() + off; FD.parse = D.parse; FD.UTC = D.UTC;
        window.Date = FD;
      }, opts.skewMs);
    }
    await page.evaluateOnNewDocument(TOASTS);
    await page.goto(appUrl(opts.query), { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForFunction(() => !!(window.LL && window.LL.auth && window.LL.auth.signInWithEmailAndPassword), { timeout: 20000 });
    if (opts.before) await page.evaluate(opts.before);
    if (!opts.existing) await makeAccount(email, opts.uid);
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
  const sheetText = (page) => page.evaluate(() => { const s = document.getElementById('sheet'); return s && s.classList.contains('show') ? s.innerText : ''; });
  const waitSheet = async (page, re, ms) => {
    try { await page.waitForFunction((src) => { const s = document.getElementById('sheet'); return !!(s && s.classList.contains('show') && new RegExp(src, 'i').test(s.innerText)); }, { timeout: ms || 20000 }, re); return true; }
    catch (e) { return false; }
  };
  const tap = (page, label) => page.evaluate((l) => {
    const b = [...document.querySelectorAll('#sheet button')].find((x) => x.textContent.trim() === l);
    if (!b) return false; b.click(); return true;
  }, label);
  const write = (page, fnSrc) => page.evaluate((src) => Promise.resolve()
    .then(() => new Function('db', 'firebase', 'return (' + src + ')(db, firebase)')(window.LL.db, window.firebase))
    .then(() => 'ok', (e) => (e && e.code) || String(e)), fnSrc);
  const read = (page, p) => page.evaluate((p) => window.LL.db.doc(p).get().then((d) => ({ exists: d.exists, data: d.exists ? d.data() : null }),
    (e) => ({ denied: e && e.code })), p);
  // Past the first-run steps (a baby, a name), so the app offers invites after boot.
  const settle = async (page, name) => {
    await page.evaluate((name) => {
      state.babies = [{ id: 'b' + Math.random().toString(36).slice(2, 7), name: 'Pip', birth: Date.now() - 40 * 86400000, sex: 'M', routines: [], doctors: [], allergies: [] }];
      state.activeBabyId = state.babies[0].id; persist();
      const uid = window.LL.auth.currentUser.uid;
      return window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + uid + '.setupDone']: true, ['memberInfo.' + uid + '.name']: name });
    }, name);
    await sleep(1500);
  };
  /* A REAL tap: scroll the element into view, then press the mouse at its centre. Whatever is on top
     at that point receives it, which is the whole point: a hidden button cannot be clicked here. */
  const centre = (page, sel, text) => page.evaluate((sel, text) => {
    const el = [...document.querySelectorAll(sel)].find((x) => text === undefined || x.textContent.trim() === text);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === el || el.contains(hit)), hit: hit ? (hit.tagName + '#' + hit.id + '.' + String(hit.className).slice(0, 30)) : null };
  }, sel, text);
  const realTap = async (page, sel, text) => {
    const c = await centre(page, sel, text);
    if (!c) return { found: false };
    await sleep(150);
    const c2 = await centre(page, sel, text);
    await page.mouse.click(c2.x, c2.y);
    return Object.assign({ found: true }, c2);
  };
  const contrastOf = (page, sel) => page.evaluate((sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const cs = getComputedStyle(el);
    const a = lum(rgb(cs.color)), b = lum(rgb(cs.backgroundColor));
    return { ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100, color: cs.color, bg: cs.backgroundColor };
  }, sel);
  const shot = async (page, name) => { if (process.env.SHOT_DIR) { await sleep(500); await page.screenshot({ path: path.join(process.env.SHOT_DIR, name + '.png') }); } };
  const familyOpen = async (page) => {
    await page.evaluate(() => window.openFamily(''));
    try { await page.waitForSelector('#llModalOv .ll-mems', { timeout: 8000 }); return true; } catch (e) { return false; }
  };
  const inviteFor = (page, email, rel) => page.evaluate((email, rel) => {
    const u = window.LL.auth.currentUser;
    return Promise.all([
      window.LL.db.collection('invites').doc(email).set({ householdId: window.LL.householdId, role: 'caregiver', relationship: rel, name: '',
        invitedBy: u.uid, status: 'pending', fromEmail: u.email.toLowerCase(), invitedByName: 'Olive' }),
      window.LL.db.doc('households/' + window.LL.householdId).update(new firebase.firestore.FieldPath('pendingInvites', email), { name: '', relationship: rel, role: 'caregiver', at: Date.now() }),
    ]).then(() => 'ok', (e) => e && e.code);
  }, email, rel);
  const joinByLink = async (email, token) => {
    const p = await person(email, { query: '&join=' + encodeURIComponent(token) });
    return { page: p, booted: await booted(p, 45000), who: await who(p) };
  };

  /* ================================================================================================
     A. Remove and Cancel invite, tapped for real, and a removal closes every live link */
  console.log('A. Olive removes Nina from Family & sharing, with a real tap, and Nina cannot walk back in');
  const A = await person('olive@circle.test');
  ok('Olive boots into a family of her own', await booted(A));
  const a = await who(A);
  await settle(A, 'Olive');
  const l1 = await A.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Auntie' }));
  const Nn = await joinByLink('nina@circle.test', l1 && l1.token);
  ok('Nina joins through a link', Nn.booted && Nn.who.hid === a.hid, Nn.who);
  const N = Nn.page;
  await N.evaluate(() => window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + window.LL.auth.currentUser.uid + '.name']: 'Nina' }));
  const l1b = await A.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Uncle' }));
  const Pp = await joinByLink('pat@circle.test', l1b && l1b.token);
  ok('and Pat through another', Pp.booted && Pp.who.hid === a.hid, Pp.who);
  await Pp.page.evaluate(() => window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + window.LL.auth.currentUser.uid + '.name']: 'Pat' }));
  ok('Olive invites Pia by email', (await inviteFor(A, 'pia@circle.test', 'Granny')) === 'ok');
  const l2 = await A.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Nanny' }));
  ok('and makes a link she has not sent yet', !!(l2 && l2.token), l2);
  await sleep(1200);
  const seen = await read(N, 'households/' + a.hid);
  const seenTokens = Object.keys((seen.data && seen.data.pendingLinks) || {});
  /* Lane B, D1: the circle's list is keyed by a row id now and the token is owner-only, so under these
     rules Nina cannot read it at all; removing her still cancels every live link (defence in depth,
     and the only defence under older rules, where the row is keyed by the token she can read). */
  if (!OLD_MODE) ok('Nina, a member, cannot read that link\'s token off the family document', !seenTokens.includes(l2.token) && !JSON.stringify(seen.data || {}).includes(l2.token) && seenTokens.includes(l2.rowId), seenTokens);
  else ok('(older rules: the hole) Nina, a member, can read that link\'s token off the family document', seenTokens.includes(l2.token), seenTokens);

  ok('Olive opens Family & sharing', await familyOpen(A));
  const rmN = await realTap(A, '.ll-rm[data-uid="' + Nn.who.uid + '"]');
  ok('she taps Remove beside Nina (a real tap, on top)', rmN.found && rmN.onTop, rmN);
  ok('the confirm opens', await waitSheet(A, 'Remove Nina', 5000), await sheetText(A));
  await sleep(500);
  const confirmTxt = await sheetText(A);
  ok('it says, honestly, that her unused links go too', /Any unused invite links are cancelled too, so you can send fresh ones\./.test(confirmTxt), confirmTxt);
  const yes = await centre(A, '#sheet button', 'Remove');
  ok('and it is drawn ON TOP of Family & sharing, where her finger is', !!yes && yes.onTop, yes);
  await shot(A, 'remove-confirm-390');
  await realTap(A, '#sheet button', 'Remove');
  const gone = await until(async () => { const h = await adminGet('households/' + a.hid); return h && !(h.members || {})[Nn.who.uid] ? h : null; }, 10000);
  ok('one real tap on Remove removes Nina', !!gone, gone && Object.keys(gone.members || {}));
  ok('the link she read is cancelled', (await until(async () => (await adminGet('inviteLinks/' + l2.token)) === null, 8000)) === true);
  const hhAfter = await adminGet('households/' + a.hid);
  ok('and its row is gone from Olive\'s list', !((hhAfter && hhAfter.pendingLinks) || {})[l2.rowId || l2.token], Object.keys((hhAfter && hhAfter.pendingLinks) || {}));
  // Exactly the join claimInviteLink makes: claim, consume and join in one batch.
  const back = await write(N, `(db, firebase) => { const b = db.batch(); const uid = '${Nn.who.uid}';
    b.update(db.doc('inviteLinks/${l2.token}'), { usedBy: uid, consumed: true });
    b.update(db.doc('households/${a.hid}'), { joinToken: '${l2.token}', ['members.' + uid]: 'caregiver',
      ['memberInfo.' + uid]: { name: 'Nina', role: 'caregiver', relationship: 'Nanny' }, ['pendingLinks.${l2.token}']: firebase.firestore.FieldValue.delete() });
    return b.commit(); }`);
  ok('Nina tries to come back in with the token she read: refused', back !== 'ok', back);
  ok('and she is not in the family', !(((await adminGet('households/' + a.hid)) || {}).members || {})[Nn.who.uid]);

  console.log('\nA2. Olive starts to remove Pat, and keeps him, on a 320px phone');
  ok('Family & sharing is back after the removal', await A.evaluate(() => !!document.getElementById('llModalOv')));
  await A.setViewport({ width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await sleep(300);
  const rmP = await realTap(A, '.ll-rm[data-uid="' + Pp.who.uid + '"]');
  ok('she taps Remove beside Pat', rmP.found && rmP.onTop, rmP);
  ok('the confirm opens', await waitSheet(A, 'Remove Pat', 5000));
  await sleep(500);
  const confirmP = await sheetText(A);
  ok('with no live links left, it does not mention links', !/invite links/.test(confirmP), confirmP);
  const sideways = await A.evaluate(() => { const s = document.getElementById('sheet'); return s.scrollWidth - s.clientWidth; });
  ok('the confirm fits a 320px screen without scrolling sideways', sideways <= 0, sideways);
  await shot(A, 'remove-confirm-320');
  const keep = await realTap(A, '#sheet button', 'Keep');
  ok('she taps Keep (on top too)', keep.found && keep.onTop, keep);
  await sleep(600);
  const afterKeep = await A.evaluate(() => { const s = document.getElementById('sheet'), sc = document.getElementById('scrim');
    return { sheetOpen: s.classList.contains('show'), modal: !!document.getElementById('llModalOv'), zSheet: s.style.zIndex, zScrim: sc.style.zIndex }; });
  ok('the confirm closes and Family & sharing is still there', !afterKeep.sheetOpen && afterKeep.modal, afterKeep);
  ok('and the sheet goes back to its own stacking once closed', afterKeep.zSheet === '' && afterKeep.zScrim === '', afterKeep);
  ok('Pat is still in the family', !!(((await adminGet('households/' + a.hid)) || {}).members || {})[Pp.who.uid]);
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await sleep(300);

  console.log('\nA3. Olive cancels Pia\'s invite, with a real tap');
  const cx = await realTap(A, '.ll-cancel-inv[data-email="pia@circle.test"]');
  ok('she taps Cancel beside Pia', cx.found && cx.onTop, cx);
  ok('the confirm opens', await waitSheet(A, 'Cancel this invite', 5000));
  await sleep(500);
  const cyes = await centre(A, '#sheet button', 'Cancel invite');
  ok('on top of Family & sharing', !!cyes && cyes.onTop, cyes);
  await shot(A, 'cancel-invite-confirm-390');
  await realTap(A, '#sheet button', 'Cancel invite');
  ok('one real tap cancels it: the invite is gone', (await until(async () => (await adminGet('invites/pia@circle.test')) === null, 8000)) === true);
  ok('and so is its row', !((((await adminGet('households/' + a.hid)) || {}).pendingInvites) || {})['pia@circle.test']);
  await A.evaluate(() => { try { document.getElementById('llModalOv').remove(); } catch (e) {} });

  /* ================================================================================================
     B. The owner's list of who she invited */
  console.log('\nB. Olive invites Otto while offline, closes Cubby, and opens it again online');
  const ctxA = A.browserContext();
  ok('Family & sharing opens', await familyOpen(A));
  await A.setOfflineMode(true);
  await A.evaluate(() => {
    document.getElementById('llInvName').value = 'Otto';
    document.getElementById('llInvEmail').value = 'otto@circle.test';
    document.getElementById('llInvBtn').click();
  });
  const readyMsg = await until(() => A.evaluate(() => { const m = document.getElementById('llInvMsg'); return m && /Invite ready/.test(m.innerText) ? m.innerText : ''; }), 12000);
  ok('offline, she still gets "Invite ready"', !!readyMsg, readyMsg);
  await A.close();
  const A2 = await ctxA.newPage();
  wire(A2, 'olive@circle.test (relaunch)');
  await A2.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await A2.evaluateOnNewDocument(TOASTS);
  await A2.goto(appUrl(), { waitUntil: 'networkidle2', timeout: 45000 });
  ok('back online, she boots into her family', (await booted(A2, 45000)) && (await who(A2)).hid === a.hid);
  ok('the queued invite reached the server', !!(await until(() => adminGet('invites/otto@circle.test'), 15000)));
  const ottoRow = await until(async () => { const h = await adminGet('households/' + a.hid); return h && (h.pendingInvites || {})['otto@circle.test']; }, 15000);
  ok('and her circle lists it as waiting', !!ottoRow, ottoRow);
  ok('Family & sharing opens', await familyOpen(A2));
  ok('showing Otto\'s invite, so she can see it and cancel it', await A2.evaluate(() => /otto@circle\.test/.test(document.getElementById('llModalOv').innerText)));
  await A2.evaluate(() => { try { document.getElementById('llModalOv').remove(); } catch (e) {} });

  console.log('\nB2. Olive invites an address another family already invited');
  await adminSet('households/HSQ', { ownerId: 'hana', members: { hana: 'owner' }, memberInfo: { hana: { name: 'Hana', role: 'owner' } } });
  await adminSet('invites/sq@circle.test', { householdId: 'HSQ', role: 'caregiver', invitedBy: 'hana' });
  ok('Family & sharing opens', await familyOpen(A2));
  await A2.evaluate(() => {
    document.getElementById('llInvName').value = 'Sky';
    document.getElementById('llInvEmail').value = 'sq@circle.test';
    document.getElementById('llInvBtn').click();
  });
  const sqMsg = await until(() => A2.evaluate(() => { const m = document.getElementById('llInvMsg'); return m && /couldn’t make an invite/.test(m.innerText) ? m.innerText : ''; }), 12000);
  ok('she is told Cubby could not make that invite', !!sqMsg, sqMsg);
  await sleep(2500);
  const sqRow = (((await adminGet('households/' + a.hid)) || {}).pendingInvites || {})['sq@circle.test'];
  ok('and no "Invited, waiting" row is left for someone nobody invited', !sqRow, sqRow);
  ok('(the other family\'s invite is untouched)', ((await adminGet('invites/sq@circle.test')) || {}).householdId === 'HSQ');
  await A2.evaluate(() => { try { document.getElementById('llModalOv').remove(); } catch (e) {} });

  /* Round-5 review VJ-1. Waiting for the link deletes before the removal write meant that offline
     the removal was never issued: her screen still showed Pat, and closing Cubby lost it, so the
     person she removed kept full access. */
  console.log('\nB3. Olive removes Pat while offline, closes Cubby, and opens it again online');
  const l4 = await A2.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Cousin' }));
  ok('(she has a live link out)', !!(l4 && l4.token), l4);
  await sleep(1200);
  ok('Family & sharing opens', await familyOpen(A2));
  await A2.setOfflineMode(true);
  const rmOff = await realTap(A2, '.ll-rm[data-uid="' + Pp.who.uid + '"]');
  ok('offline, she taps Remove beside Pat', rmOff.found && rmOff.onTop, rmOff);
  ok('the confirm opens', await waitSheet(A2, 'Remove Pat', 5000));
  await sleep(500);
  await realTap(A2, '#sheet button', 'Remove');
  const offGone = await until(() => A2.evaluate((pu) => !((window.LL.memberInfo || {})[pu]) || null, Pp.who.uid), 6000);
  ok('offline, her own Cubby already shows Pat removed', !!offGone, offGone);
  await sleep(2000);
  await A2.close();
  const A3 = await ctxA.newPage();
  wire(A3, 'olive@circle.test (relaunch 2)');
  await A3.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await A3.evaluateOnNewDocument(TOASTS);
  await A3.goto(appUrl(), { waitUntil: 'networkidle2', timeout: 45000 });
  ok('back online, she boots into her family', (await booted(A3, 45000)) && (await who(A3)).hid === a.hid);
  const patGone = await until(async () => { const h = await adminGet('households/' + a.hid); return h && !(h.members || {})[Pp.who.uid] ? h : null; }, 15000);
  ok('the removal she made offline reached the server: Pat is out', !!patGone, patGone && patGone.members);
  ok('and the link she had out is cancelled', (await until(async () => (await adminGet('inviteLinks/' + l4.token)) === null, 8000)) === true);
  ok('and its row is gone from her list', !(((await adminGet('households/' + a.hid)) || {}).pendingLinks || {})[l4.rowId || l4.token]);

  /* ================================================================================================
     C. An invite into a family that has closed */
  if (!OLD_MODE) {
    console.log('\nC. Gus has a Cubby, and an invite into a family that has since closed');
    await adminSet('households/HCLOSED', { ownerId: 'faye', members: {}, memberInfo: {}, deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'faye' });
    const Gp = await person('gus@circle.test');
    ok('Gus boots into a Cubby of his own', await booted(Gp, 45000));
    await settle(Gp, 'Gus');
    await adminSet('invites/gus@circle.test', { householdId: 'HCLOSED', role: 'caregiver', invitedBy: 'faye', fromEmail: 'faye@circle.test', invitedByName: 'Faye' });
    await Gp.reload({ waitUntil: 'networkidle2', timeout: 45000 });
    ok('he boots', await booted(Gp, 45000));
    ok('he is offered the invite', await waitSheet(Gp, 'invited', 20000));
    ok('he taps Join the family', await tap(Gp, 'Join the family'));
    const gt = await until(async () => (await toasts(Gp)).find((t) => /no longer open/.test(t)), 10000);
    ok('he is told it is no longer open', !!gt, await toasts(Gp));
    ok('and the dead invite is thrown away', (await until(async () => (await adminGet('invites/gus@circle.test')) === null, 8000)) === true);
    await Gp.reload({ waitUntil: 'networkidle2', timeout: 45000 });
    ok('next launch he boots into his own Cubby', (await booted(Gp, 45000)) && (await who(Gp)).hid !== 'HCLOSED');
    await sleep(4000);
    ok('and is not offered it again', !/invited/i.test(await sheetText(Gp)), await sheetText(Gp));
    await Gp.browserContext().close();
  }

  /* ================================================================================================
     D. Who is in charge after the owner deletes her account */
  console.log('\nD. Oona (owner) deletes her account; Cora is already a co-owner, Nan is a caregiver');
  // uids chosen so the caregiver sorts FIRST: the old pick was simply the lowest uid.
  await adminSet('households/HHEIR1', { ownerId: 'mm-oona', members: { 'mm-oona': 'owner', 'zz-cora': 'owner', 'aa-nan': 'caregiver' },
    memberInfo: { 'mm-oona': { name: 'Oona', role: 'owner', relationship: 'Mama Bear', setupDone: true }, 'zz-cora': { name: 'Cora', role: 'owner', relationship: 'Auntie Bear' },
      'aa-nan': { name: 'Nan', role: 'caregiver', relationship: 'Nanny' } }, app: { babies: [] } });
  await adminSet('users/mm-oona', { householdId: 'HHEIR1' });
  const Oo = await person('oona@circle.test', { uid: 'mm-oona' });
  ok('Oona boots into her family', (await booted(Oo, 45000)) && (await who(Oo)).hid === 'HHEIR1', await who(Oo));
  const od = await Oo.evaluate(() => window.LL.deleteAccount().then(() => 'ok', (e) => (e && (e.code || e.message)) || String(e)));
  ok('she deletes her account', od === 'ok', od);
  const h1 = await adminGet('households/HHEIR1');
  ok('Cora, already a co-owner, is left in charge', h1 && h1.ownerId === 'zz-cora' && (h1.members || {})['zz-cora'] === 'owner', h1 && { ownerId: h1.ownerId, members: h1.members });
  ok('and Nan stays a caregiver: nobody is promoted over Cora', h1 && (h1.members || {})['aa-nan'] === 'caregiver', h1 && h1.members);
  await Oo.browserContext().close();

  console.log('\nD2. Opal (owner) deletes her account; Paddy is "Papa Bear", Nell is "Nanny", both caregivers');
  await adminSet('households/HHEIR2', { ownerId: 'mm-opal', members: { 'mm-opal': 'owner', 'zz-paddy': 'caregiver', 'aa-nell': 'caregiver' },
    memberInfo: { 'mm-opal': { name: 'Opal', role: 'owner', relationship: 'Mama Bear', setupDone: true }, 'zz-paddy': { name: 'Paddy', role: 'caregiver', relationship: 'Papa Bear' },
      'aa-nell': { name: 'Nell', role: 'caregiver', relationship: 'Nanny' } }, app: { babies: [] } });
  await adminSet('users/mm-opal', { householdId: 'HHEIR2' });
  const Op = await person('opal@circle.test', { uid: 'mm-opal' });
  ok('Opal boots into her family', (await booted(Op, 45000)) && (await who(Op)).hid === 'HHEIR2', await who(Op));
  const opd = await Op.evaluate(() => window.LL.deleteAccount().then(() => 'ok', (e) => (e && (e.code || e.message)) || String(e)));
  ok('she deletes her account', opd === 'ok', opd);
  const h2 = await adminGet('households/HHEIR2');
  ok('Papa Bear, the app\'s own label for a parent, inherits the family', h2 && h2.ownerId === 'zz-paddy' && (h2.members || {})['zz-paddy'] === 'owner', h2 && { ownerId: h2.ownerId, members: h2.members });
  ok('and the nanny stays a caregiver', h2 && (h2.members || {})['aa-nell'] === 'caregiver', h2 && h2.members);
  await Op.browserContext().close();

  /* ================================================================================================
     E. The last one out, on a phone whose clock is 25 days slow */
  console.log('\nE. Sol, the only one in her Cubby, deletes her account; her phone thinks it is 25 days ago');
  const Sp = await person('sol@circle.test', { skewMs: -25 * DAY });
  ok('Sol boots into a Cubby of her own', await booted(Sp, 45000));
  const s = await who(Sp);
  ok('(her clock really is 25 days slow)', await Sp.evaluate(() => Date.now()) < Date.now() - 24 * DAY);
  const sd = await Sp.evaluate(() => window.LL.deleteAccount().then(() => 'ok', (e) => (e && (e.code || e.message)) || String(e)));
  ok('she deletes her account, and it finishes', sd === 'ok', sd);
  const hs = await adminGet('households/' + s.hid);
  ok('her family is flagged with nobody left in it', hs && Object.keys(hs.members || {}).length === 0 && hs.deletionRequestedBy === s.uid, hs && { members: hs.members, by: hs.deletionRequestedBy });
  const days = hs && typeof hs.deleteAfter === 'number' ? (hs.deleteAfter - Date.now()) / DAY : null;
  if (!OLD_MODE) ok('30 days out by the server\'s clock, as the privacy page says', days !== null && days > 29.5 && days < 30.5, { days });
  else console.log('  ..   (live rules accept the phone\'s own clock: ' + (days === null ? 'no flag' : days.toFixed(2) + ' days') + ')');
  await Sp.browserContext().close();

  /* ================================================================================================
     F. The full-screen notes are on top, and readable */
  console.log('\nF. Rosa has Family & sharing open when Olive removes her');
  const l3 = await A3.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Nanny' }));
  const Rr = await joinByLink('rosa@circle.test', l3 && l3.token);
  ok('Rosa joins', Rr.booted && Rr.who.hid === a.hid, Rr.who);
  const R = Rr.page;
  ok('she opens Family & sharing', await familyOpen(R));
  const rm = await write(A3, `(db, firebase) => db.doc('households/${a.hid}').update({ 'members.${Rr.who.uid}': firebase.firestore.FieldValue.delete(),
    'memberInfo.${Rr.who.uid}': firebase.firestore.FieldValue.delete(), 'formerMemberInfo.${Rr.who.uid}': { name: 'Rosa', relationship: 'Nanny', avatar: null } })`);
  ok('Olive removes her', rm === 'ok', rm);
  ok('Rosa is told she is no longer in this family', !!(await until(() => R.evaluate(() => { const o = document.getElementById('ll-access-lost'); return !!(o && /no longer in this family/.test(o.innerText)); }), 15000)));
  const alTop = await centre(R, '#ll-al-btn');
  ok('the note is on top: its button is what her finger would press', !!alTop && alTop.onTop, alTop);
  ok('and Family & sharing is closed underneath it', !(await R.evaluate(() => !!document.getElementById('llModalOv'))));
  const alC = await contrastOf(R, '#ll-al-btn');
  ok('"Back to sign in" reads at 4.5:1 or better', !!alC && alC.ratio >= 4.5, alC);
  await shot(R, 'access-lost-390');

  console.log('\nF2. Mia follows an invite link with no invite for her address, with a sheet open');
  const Mp = await person('mia@circle.test', { query: '&join=1', before: () => { window.openFeedback(); window.__sheetWasOpen = !!document.getElementById('llModalOv'); } });
  ok('(a store sheet really was open when she signed in)', await Mp.evaluate(() => window.__sheetWasOpen === true));
  const mt = await until(() => Mp.evaluate(() => { const o = document.getElementById('ll-invite-mismatch'); return o ? o.innerText : ''; }), 20000);
  ok('she is told there is no invite for her address', /We could not find your invite/.test(mt || ''), mt);
  const imTop = await centre(Mp, '#ll-im-btn');
  ok('the note is on top', !!imTop && imTop.onTop, imTop);
  ok('and the sheet underneath it is closed', !(await Mp.evaluate(() => !!document.getElementById('llModalOv'))));
  const imC = await contrastOf(Mp, '#ll-im-btn');
  ok('"Try a different sign in" reads at 4.5:1 or better', !!imC && imC.ratio >= 4.5, imC);
  await shot(Mp, 'no-invite-390');

  ok('no page errors on any phone', errs.length === 0, errs.slice(0, 4));
  /* Every other host is unresolvable (--host-resolver-rules), so anything off localhost can be tried but
     never answered. The Firebase SDK's own offline probe tries www.google.com when the page goes offline. */
  ok('nothing off localhost was ever answered', offHostAnswered.length === 0, [...new Set(offHostAnswered)]);
  if (offHost.length) console.log('  ..   tried and refused by the host rules: ' + JSON.stringify([...new Set(offHost)]));

  await browser.close();
  serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('CIRCLE-MANAGE: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
