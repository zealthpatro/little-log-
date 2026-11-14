/* Invite-link secrecy, a removal that closes her other invites, and two account deletions at once,
 * end to end in the real app with the REAL rules enforced. November 2026 review, lane B.
 *
 *   A. D1. A caregiver reads the family document and finds no live link token in it, by rules and in
 *      the browser: the circle's list of pending links is keyed by a row id that opens nothing, and
 *      the token is in households/{hid}/ownerLinks, which she cannot read or list. A link an older
 *      build made (token-keyed row) is moved by the owner's own device the next time she opens Cubby,
 *      and still admits the person it was for. Send again and Cancel work for new and moved links,
 *      and removing someone still cancels every live link.
 *   B. P4. Hana joined by link with a Hide My Email address while her owner's email invite to her
 *      real address was still waiting. Removing Hana now cancels that invite too (same name, whole,
 *      any case), the confirm sheet says so naming the address, and a different person's invite is
 *      left alone. With her real address she can no longer write herself back in.
 *   C. D4. Two deletions at once, forced interleaving: each phone is held to the family it saw before
 *      the other one's write landed. The owner going second no longer writes her departed heir back
 *      in as owner; the heir going second (on a phone 25 days slow) no longer leaves an empty family
 *      that is never purged. Either way the last one out schedules the deletion 30 days after the
 *      SERVER's clock. Then both at once for real.
 *   D. The deploy window, in one sitting. Wendy's and Willa's Cubby is already open when the rules
 *      that hide link tokens are published, and stays open. Wendy's next link is keyed by a row id,
 *      and the row she made before moves too; Willa makes no link, and her old row still moves once
 *      her family document changes. Nobody relaunches anything.
 *   Also: a second phone that does not hold a link's token yet, offline, says it could not cancel
 *   that link and changes nothing (A3b); a link someone with an older Cubby uses leaves the owner's
 *   list while her Cubby stays open (A4b); a 60-character address with nowhere to break it wraps in
 *   the remove sheet and the family list at 320px and 390px, while ordinary names and addresses beside
 *   it stay whole, never broken mid-word (B2); a row whose link and token copy are both already gone
 *   can be cleared, and only once the server says so (A3c).
 *
 * Harness: test/circle-manage.test.js's. ?authemu runs the real Firebase Auth SDK against the Auth
 * emulator, so every write carries a real (emulator) token and the Firestore emulator enforces the
 * rules. Accounts are made verified, like every real sign-in. Chrome downloads go to a temp folder
 * (tools/gate_downloads.js) and every host but localhost is unresolvable.
 *
 *   node test/links-leave.test.js                    (rules = ./firestore.rules)
 *   RULES_FILE=<file> node test/links-leave.test.js  the deploy window: this client against rules
 *       published before (866851ac's, or the live 1a6df125's). Links are made the old way there and
 *       must still work end to end; sections that need the new rules say what they check instead.
 *   RULES_BEFORE=<file>  section D's rules published before ownerLinks (default: RULES_FILE when it is
 *       set, else `git show 866851ac:firestore.rules`, the November security release).
 *
 * Ports: FS_PORT, AUTH_PORT, WEB_PORT, HUB_PORT, LOG_PORT, WS_PORT. SHOT_DIR saves screenshots.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FS_PORT = Number(process.env.FS_PORT) || 8747;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9747;
const WEB_PORT = Number(process.env.WEB_PORT) || 8748;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const EXEC_PROJECT = 'demo-cubby-links';
const PAGE_PROJECT = 'little-log-a9caa'; // the id app/firebase-init.js gives the SDK; emulator only
const RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'firestore.rules');
const OLD_MODE = !!process.env.RULES_FILE;
// Section D publishes the new rules mid-run, over these: the last rules published before ownerLinks.
const RULES_BEFORE_LABEL = process.env.RULES_BEFORE || (OLD_MODE ? RULES_FILE : 'git show 866851ac:firestore.rules');
const readRulesBefore = () => {
  try {
    if (process.env.RULES_BEFORE) return fs.readFileSync(process.env.RULES_BEFORE, 'utf8');
    if (OLD_MODE) return fs.readFileSync(RULES_FILE, 'utf8');
    return execFileSync('git', ['show', '866851ac:firestore.rules'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { return ''; }
};
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = 'emulator-only-pw-links';
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
if (!process.env.LINKS_LEAVE_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-links-'));
  fs.copyFileSync(RULES_FILE, path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { LINKS_LEAVE_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
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
// Only the named field paths, the rest of the document left as it is.
async function adminPatch(p, data, maskPaths) {
  const mask = maskPaths.map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const r = await fetch(FS_DOCS + p + '?' + mask, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields: toValue(data).mapValue.fields }) });
  if (r.status !== 200) throw new Error('patch ' + p + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
async function adminGet(p) {
  const r = await fetch(FS_DOCS + p, { headers: ADMIN });
  if (r.status === 404) return null;
  const j = await r.json();
  return fromValue({ mapValue: { fields: j.fields || {} } });
}
// Publish a ruleset to the running emulator, as a deploy would, while every page stays open.
async function setRules(content) {
  const r = await fetch(`http://localhost:${FS_PORT}/emulator/v1/projects/${PAGE_PROJECT}:securityRules`,
    { method: 'PUT', body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }) });
  return r.status;
}
async function until(fn, ms) {
  const stop = Date.now() + (ms || 10000);
  let v;
  while (Date.now() < stop) { v = await fn(); if (v) return v; await sleep(250); }
  return v;
}
// A token is 22 base62 characters. Matched as a WHOLE token, never as part of a longer run.
const hasTok = (s, tok) => !!tok && new RegExp('(^|[^A-Za-z0-9])' + tok + '([^A-Za-z0-9]|$)').test(String(s));
const isRowId = (k) => /^r_[A-Za-z0-9]{16}$/.test(String(k || ''));
const newTok = () => { const A = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let s = 'Lg'; for (let i = 0; i < 20; i++) s += A[Math.floor(Math.random() * A.length)]; return s; };

/* ---------- inner phase ---------- */
(async () => {
  console.log('\nlink secrecy, removal and two deletions at once, with the real rules (' + (OLD_MODE ? 'OLDER rules: ' + RULES_FILE : 'firestore.rules') + ')\n');
  const serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
    { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(WEB_PORT) }) });
  // Never leave it serving after a crash: the next run on this port would grade THIS tree, not its own.
  process.on('exit', () => { try { serveProc.kill(); } catch (e) {} });
  for (let i = 0; i < 40 && (await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200; i++) await sleep(250);
  const servedStore = await fetch(`http://localhost:${WEB_PORT}/app/store-firebase.js`).then((r) => r.text()).catch(() => '');
  ok('the static server serves THIS checkout\'s store-firebase.js, byte for byte', servedStore === fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8'));

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const dl = require(path.join(ROOT, 'tools', 'gate_downloads.js'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', downloadBehavior: dl.downloadBehavior(),
    args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1'] });
  const errs = [], offHostAnswered = [];
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
    page.on('response', (rs) => { try { const h = new URL(rs.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHostAnswered.push(h); } catch (e) {} });
  };
  // Every toast this page shows, heard twice over: the toast() call, and what lands in #toast.
  const TOASTS = () => {
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => {
      try { const t = window.toast; if (typeof t === 'function' && !t.__w) { const w = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; w.__w = 1; window.toast = w; } } catch (e) {}
      try {
        const el = document.getElementById('toast');
        if (el) new MutationObserver(() => { const x = (el.textContent || '').trim(); if (x && window.__toasts[window.__toasts.length - 1] !== x) window.__toasts.push(x); })
          .observe(el, { childList: true, characterData: true, subtree: true });
      } catch (e) {}
    });
  };
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
    if (!opts.existing) await makeAccount(email, opts.uid);
    // A phone whose copy of the owner's link tokens has not arrived yet: its ownerLinks listener never
    // delivers (one-off reads still go through).
    if (opts.blockOwnerLinks) await page.evaluate(() => {
      const P = window.firebase.firestore.CollectionReference.prototype, orig = P.onSnapshot;
      P.onSnapshot = function () { if (/\/ownerLinks$/.test(this.path)) { window.__blockedOwnerLinks = (window.__blockedOwnerLinks || 0) + 1; return function () {}; } return orig.apply(this, arguments); };
    });
    await page.evaluate((e, p) => window.LL.auth.signInWithEmailAndPassword(e, p).then(() => true), email, PW);
    return page;
  };
  const relaunch = async (ctx, email) => {
    const p = await ctx.newPage();
    wire(p, email + ' (relaunch)');
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await p.evaluateOnNewDocument(TOASTS);
    await p.goto(appUrl(), { waitUntil: 'networkidle2', timeout: 45000 });
    return p;
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
  const write = (page, fnSrc) => page.evaluate((src) => Promise.resolve()
    .then(() => new Function('db', 'firebase', 'return (' + src + ')(db, firebase)')(window.LL.db, window.firebase))
    .then(() => 'ok', (e) => (e && e.code) || String(e)), fnSrc);
  const read = (page, p) => page.evaluate((p) => window.LL.db.doc(p).get({ source: 'server' }).then((d) => ({ exists: d.exists, data: d.exists ? d.data() : null }),
    (e) => ({ denied: e && e.code })), p);
  const sheetText = (page) => page.evaluate(() => { const s = document.getElementById('sheet'); return s && s.classList.contains('show') ? s.innerText : ''; });
  const waitSheet = async (page, re, ms) => {
    try { await page.waitForFunction((src) => { const s = document.getElementById('sheet'); return !!(s && s.classList.contains('show') && new RegExp(src, 'i').test(s.innerText)); }, { timeout: ms || 20000 }, re); return true; }
    catch (e) { return false; }
  };
  const settle = async (page, name) => {
    await page.evaluate((name) => {
      state.babies = [{ id: 'b' + Math.random().toString(36).slice(2, 7), name: 'Pip', birth: Date.now() - 40 * 86400000, sex: 'M', routines: [], doctors: [], allergies: [] }];
      state.activeBabyId = state.babies[0].id; persist();
      const uid = window.LL.auth.currentUser.uid;
      return window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + uid + '.setupDone']: true, ['memberInfo.' + uid + '.name']: name });
    }, name);
    await sleep(1500);
  };
  const nameMe = (page, name) => page.evaluate((name) => window.LL.db.doc('households/' + window.LL.householdId)
    .update({ ['memberInfo.' + window.LL.auth.currentUser.uid + '.name']: name, ['memberInfo.' + window.LL.auth.currentUser.uid + '.setupDone']: true }), name);
  const centre = (page, sel, text) => page.evaluate((sel, text) => {
    const el = [...document.querySelectorAll(sel)].find((x) => text === undefined || x.textContent.trim() === text);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, w: r.width, h: r.height, onTop: !!hit && (hit === el || el.contains(hit)) };
  }, sel, text);
  const realTap = async (page, sel, text) => {
    const c = await centre(page, sel, text);
    if (!c) return { found: false };
    await sleep(150);
    const c2 = await centre(page, sel, text);
    await page.mouse.click(c2.x, c2.y);
    return Object.assign({ found: true }, c2);
  };
  const SHOT_DIR = process.env.SHOT_DIR || '';
  const shot = async (page, name) => { if (SHOT_DIR) { await sleep(500); await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') }); } };
  const familyOpen = async (page) => {
    await page.evaluate(() => { try { document.getElementById('llModalOv').remove(); } catch (e) {} window.openFamily(''); });
    try { await page.waitForSelector('#llModalOv .ll-mems', { timeout: 8000 }); return true; } catch (e) { return false; }
  };
  const joinByLink = async (email, token) => {
    const p = await person(email, { query: '&join=' + encodeURIComponent(token) });
    return { page: p, booted: await booted(p, 45000), who: await who(p) };
  };
  // Send again and Copy go to the clipboard here; the share sheet is the phone's, not ours to drive.
  const catchCopies = (page) => page.evaluate(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(String(t)); return Promise.resolve(); } }, configurable: true });
  });
  const lastCopy = (page) => page.evaluate(() => (window.__copied || []).slice(-1)[0] || '');
  // The row key a link sits under on the owner's list: its row id, or the token for the old shape.
  const rowKeyOf = (link) => (link && isRowId(link.rowId)) ? link.rowId : (link && link.token);
  const rowSel = (cls, key) => '.' + cls + '[data-row="' + key + '"],.' + cls + '[data-token="' + key + '"]';

  /* ================================================================================================
     A. D1: a caregiver cannot read a live link's token */
  console.log('A. Olive makes links; Nina, a caregiver, reads everything she is allowed to');
  const A = await person('olive@links.test');
  ok('Olive boots into a family of her own', await booted(A));
  const a = await who(A);
  await settle(A, 'Olive');
  const ctxA = A.browserContext();
  const l1 = await A.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Auntie' }));
  ok('Olive makes a link', !!(l1 && l1.token), l1);
  const Nn = await joinByLink('nina@links.test', l1 && l1.token);
  ok('Nina joins through it', Nn.booted && Nn.who.hid === a.hid && Nn.who.role === 'caregiver', Nn.who);
  const N = Nn.page;
  await nameMe(N, 'Nina');
  const hJoin = await adminGet('households/' + a.hid);
  ok('her join cleared that link\'s row from Olive\'s list', !(rowKeyOf(l1) in ((hJoin && hJoin.pendingLinks) || {})), Object.keys((hJoin && hJoin.pendingLinks) || {}));
  const l2 = await A.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Nanny' }));
  ok('Olive makes a second link she has not sent yet', !!(l2 && l2.token), l2);
  await sleep(1500);

  const seen = await read(N, 'households/' + a.hid);
  const seenRows = Object.keys((seen.data && seen.data.pendingLinks) || {});
  ok('Nina can read the family document (she is in the family)', seen.exists === true, seen);
  if (!OLD_MODE) {
    ok('the live token is nowhere in what she reads', !hasTok(JSON.stringify(seen.data), l2 && l2.token), seenRows);
    ok('nor in what her own app holds', !(await N.evaluate((t) => JSON.stringify({ p: window.LL.hhPendingLinks, o: window.LL.ownerLinks }).indexOf(t) >= 0, l2 && l2.token)));
    ok('the list still has a row for it, under an id that is not the token', !!l2 && isRowId(l2.rowId) && seenRows.includes(l2.rowId) && l2.rowId !== l2.token, { rowId: l2 && l2.rowId, seenRows });
    const ownCopy = await read(A, 'households/' + a.hid + '/ownerLinks/' + (l2 && l2.rowId));
    ok('Olive, the owner, reads the token under that row id (the same matcher finds it there)', ownCopy.exists === true && hasTok(JSON.stringify(ownCopy.data), l2.token), ownCopy);
    const nOwn = await read(N, 'households/' + a.hid + '/ownerLinks/' + (l2 && l2.rowId));
    ok('Nina cannot read that row\'s token', nOwn.denied === 'permission-denied', nOwn);
    const nList = await N.evaluate((hid) => window.LL.db.collection('households/' + hid + '/ownerLinks').get().then(() => 'read', (e) => e.code), a.hid);
    ok('nor list the tokens', nList === 'permission-denied', nList);
    const nQuery = await N.evaluate((hid) => window.LL.db.collection('inviteLinks').where('householdId', '==', hid).get().then(() => 'read', (e) => e.code), a.hid);
    ok('nor find a link by querying for her family', nQuery === 'permission-denied', nQuery);
  } else {
    ok('(older rules) the link is made the old way: its row is keyed by the token, which is all these rules allow',
      seenRows.includes(l2.token) && l2.rowId === l2.token, { seenRows, l2 });
  }

  console.log('\nA2. A link an older build made, before row ids: Olive opens Cubby again');
  await A.close();
  const TL = newTok();
  await adminSet('inviteLinks/' + TL, { householdId: a.hid, role: 'caregiver', relationship: 'Granny', usedBy: null, invitedBy: a.uid, expiresAt: new Date(Date.now() + 20 * 3600000) });
  await adminPatch('households/' + a.hid, { pendingLinks: { [TL]: { at: Date.now() - 3600000, expiresAt: Date.now() + 20 * 3600000, sentTo: '' } } }, ['pendingLinks.' + TL]);
  const before = await read(N, 'households/' + a.hid);
  ok('(the matcher finds an old-shape token on the family document while it is there)', hasTok(JSON.stringify(before.data), TL), Object.keys((before.data && before.data.pendingLinks) || {}));
  const A2 = await relaunch(ctxA, 'olive@links.test');
  ok('Olive opens Cubby again', (await booted(A2, 45000)) && (await who(A2)).hid === a.hid);
  let movedRow = null;
  if (!OLD_MODE) {
    const moved = await until(async () => { const h = await adminGet('households/' + a.hid); return h && !((h.pendingLinks || {})[TL]) ? h : null; }, 15000);
    ok('her device moves the old row: the token is off the family document', !!moved, moved && Object.keys(moved.pendingLinks || {}));
    const lkTL = await adminGet('inviteLinks/' + TL);
    movedRow = lkTL && lkTL.rowId;
    ok('the link has learned its row id', isRowId(movedRow) && !!(moved && (moved.pendingLinks || {})[movedRow]), { movedRow, rows: moved && Object.keys(moved.pendingLinks || {}) });
    const tokDoc = movedRow && await adminGet('households/' + a.hid + '/ownerLinks/' + movedRow);
    ok('and its token sits in her owner-only copy', !!tokDoc && tokDoc.token === TL, tokDoc);
    ok('the row kept what it said (when it was made)', !!moved && ((moved.pendingLinks || {})[movedRow] || {}).at === ((before.data.pendingLinks || {})[TL] || {}).at);
    const after = await read(N, 'households/' + a.hid);
    ok('Nina reads the family document again: no old token in it either', !hasTok(JSON.stringify(after.data), TL), Object.keys((after.data && after.data.pendingLinks) || {}));
  } else {
    await sleep(5000);
    const h = await adminGet('households/' + a.hid);
    ok('(older rules) nothing is moved, and nothing is lost: the old row and its link are as they were',
      !!((h.pendingLinks || {})[TL]) && !!(await adminGet('inviteLinks/' + TL)), Object.keys(h.pendingLinks || {}));
  }

  console.log('\nA3. Send again and Cancel, for a new link and a moved one');
  await catchCopies(A2);
  ok('Family & sharing opens', await familyOpen(A2));
  const keyL2 = rowKeyOf(l2), keyTL = movedRow || TL;
  const sa = await realTap(A2, rowSel('ll-reshare-link', keyL2));
  ok('she taps Send again beside the new link', sa.found && sa.onTop, sa);
  await sleep(400);
  const c2 = await lastCopy(A2);
  ok('it copies THAT link, whole', hasTok(c2, l2.token) && c2.indexOf('/app/?join=' + l2.token) >= 0, c2.slice(0, 120));
  const sb = await realTap(A2, rowSel('ll-reshare-link', keyTL));
  ok('she taps Send again beside the older link', sb.found && sb.onTop, sb);
  await sleep(400);
  const cL = await lastCopy(A2);
  ok('it copies the older link, whole', cL.indexOf('/app/?join=' + TL) >= 0, cL.slice(0, 120));
  ok('the buttons carry no token of a new link (the page holds the row id)', !(await A2.evaluate((t) => document.getElementById('llModalOv').innerHTML.indexOf(t) >= 0, l2.token)) || OLD_MODE);
  const cc = await realTap(A2, rowSel('ll-cancel-link', keyL2));
  ok('she taps Cancel beside the new link', cc.found && cc.onTop, cc);
  ok('the link is cancelled', (await until(async () => (await adminGet('inviteLinks/' + l2.token)) === null, 8000)) === true);
  ok('its row is gone from her list', !!(await until(async () => { const h = await adminGet('households/' + a.hid); return h && !((h.pendingLinks || {})[keyL2]); }, 8000)));
  if (!OLD_MODE) ok('and so is her copy of its token', (await until(async () => (await adminGet('households/' + a.hid + '/ownerLinks/' + keyL2)) === null, 8000)) === true);

  if (!OLD_MODE) {
    /* A row id opens nothing, so a phone that does not hold the row's token cannot cancel its link.
       It used to clear the row and the token copy anyway, leaving a live link nobody could see or
       cancel. Now it says it could not, and changes nothing. */
    console.log('\nA3b. Olive\'s second phone has not loaded her link tokens yet, and it is offline: Cancel changes nothing, and says so');
    const l4 = await A2.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Godmother' }));
    ok('(Olive makes a link on her first phone)', !!l4 && isRowId(l4.rowId), l4);
    await sleep(1500);
    const A3p = await person('olive@links.test', { existing: true, blockOwnerLinks: true });
    ok('her second phone opens Cubby, without her link tokens',
      (await booted(A3p, 45000)) && (await A3p.evaluate(() => (window.__blockedOwnerLinks || 0) > 0 && Object.keys(window.LL.ownerLinks || {}).length === 0)));
    await A3p.setOfflineMode(true);
    ok('Family & sharing opens on it, offline', await familyOpen(A3p));
    const cx = await realTap(A3p, rowSel('ll-cancel-link', l4.rowId));
    ok('she taps Cancel beside that link', cx.found && cx.onTop, cx);
    const said = await until(() => A3p.evaluate(() => (window.__toasts || []).join(' | ')), 12000);
    ok('it says it could not cancel that link', /Could not cancel that link/.test(said || ''), said);
    ok('and never that it did', !/Link cancelled/.test(said || ''), said);
    await A3p.setOfflineMode(false);
    await sleep(6000);
    const lk4 = await adminGet('inviteLinks/' + l4.token), h4 = await adminGet('households/' + a.hid);
    const c4 = await adminGet('households/' + a.hid + '/ownerLinks/' + l4.rowId);
    ok('back online, nothing was half done: the link, its row and her copy of its token are all still there, for her to cancel',
      !!lk4 && !lk4.usedBy && !!((h4.pendingLinks || {})[l4.rowId]) && !!c4, { link: !!lk4, row: !!((h4.pendingLinks || {})[l4.rowId]), copy: !!c4 });
    // The companion: online, the same tap on the same phone asks the server for the token and cancels.
    ok('Family & sharing opens on it again, online', await familyOpen(A3p));
    const cy = await realTap(A3p, rowSel('ll-cancel-link', l4.rowId));
    ok('she taps Cancel again', cy.found && cy.onTop, cy);
    ok('online, the link is cancelled', (await until(async () => (await adminGet('inviteLinks/' + l4.token)) === null, 10000)) === true);
    ok('and its row and her copy of its token go', !!(await until(async () => {
      const h = await adminGet('households/' + a.hid);
      return h && !((h.pendingLinks || {})[l4.rowId]) && (await adminGet('households/' + a.hid + '/ownerLinks/' + l4.rowId)) === null;
    }, 10000)));
    ok('and the same toast catcher hears it say so', /Link cancelled/.test(await A3p.evaluate(() => (window.__toasts || []).join(' | '))));

    /* A row whose link and token copy are both already gone (an interrupted removal deletes the link
       and the copy, and can fail before its family-document write clears the row). The guard above
       kept Cancel from clearing it, so it said "Could not cancel that link just now" for good. Online,
       the server says there is no copy, and a copy only ever goes once its link no longer works, so
       Cancel clears the row. Offline nothing can be known, so it still touches nothing. */
    console.log('\nA3c. A row whose link and token copy are both already gone: offline Cancel touches nothing, online it clears the row');
    const DEAD = 'r_' + newTok().slice(2, 18);
    await adminPatch('households/' + a.hid, { pendingLinks: { [DEAD]: { at: Date.now() - 7200000, expiresAt: Date.now() + 20 * 3600000, sentTo: '' } } }, ['pendingLinks.' + DEAD]);
    ok('(the row is on her list, with no link and no copy of a token behind it)', isRowId(DEAD)
      && !!(await until(() => A3p.evaluate((k) => !!(window.LL.hhPendingLinks || {})[k], DEAD), 10000))
      && (await adminGet('households/' + a.hid + '/ownerLinks/' + DEAD)) === null);
    await A3p.setOfflineMode(true);
    await A3p.evaluate(() => { window.__toasts = []; });
    ok('Family & sharing opens on her second phone, offline', await familyOpen(A3p));
    const dx = await realTap(A3p, rowSel('ll-cancel-link', DEAD));
    ok('she taps Cancel beside that row', dx.found && dx.onTop, dx);
    const dSaid = await until(() => A3p.evaluate(() => (window.__toasts || []).join(' | ')), 12000);
    ok('offline, it says it could not cancel that link, and nothing else', /Could not cancel that link/.test(dSaid || '') && !/already gone|Link cancelled/.test(dSaid || ''), dSaid);
    await A3p.setOfflineMode(false);
    await sleep(6000);
    ok('back online the row is still there: offline nothing could be known, so nothing was touched',
      !!((((await adminGet('households/' + a.hid)) || {}).pendingLinks || {})[DEAD]));
    await A3p.evaluate(() => { window.__toasts = []; });
    ok('Family & sharing opens on it again, online', await familyOpen(A3p));
    const dy = await realTap(A3p, rowSel('ll-cancel-link', DEAD));
    ok('she taps Cancel beside it again', dy.found && dy.onTop, dy);
    ok('online, the server says there is no copy, and the row goes', !!(await until(async () => {
      const h = await adminGet('households/' + a.hid); return h && !((h.pendingLinks || {})[DEAD]); }, 10000)));
    const dSaid2 = await until(() => A3p.evaluate(() => { const t = (window.__toasts || []).join(' | '); return /already gone/.test(t) ? t : ''; }), 8000);
    ok('and it says that link was already gone, so it has been tidied away',
      /That link was already gone, so it has been tidied away\./.test(dSaid2 || '') && !/Could not cancel|Link cancelled/.test(dSaid2 || ''), dSaid2);
    await sleep(800);
    ok('the row is off the list on her screen too', (await A3p.evaluate((k) => !!document.querySelector('#llModalOv .ll-mems') && !document.querySelector('.ll-cancel-link[data-row="' + k + '"]'), DEAD)) === true);
    await A3p.browserContext().close();
  }

  console.log('\nA4. Pia was sent the older link, and it still lets her in');
  const Pp = await joinByLink('pia@links.test', TL);
  ok('Pia joins with it', Pp.booted && Pp.who.hid === a.hid && Pp.who.role === 'caregiver', Pp.who);
  await nameMe(Pp.page, 'Pia');
  const hPia = await adminGet('households/' + a.hid);
  ok('and its row is cleared by her join', !((hPia.pendingLinks || {})[keyTL]), Object.keys(hPia.pendingLinks || {}));
  if (!OLD_MODE) ok('her device tidies its token copy away once the link is used', (await until(async () => (await adminGet('households/' + a.hid + '/ownerLinks/' + keyTL)) === null, 15000)) === true);

  /* An older Cubby's join clears the row keyed by the TOKEN, which a row-id row does not have, so the
     used link stayed on the owner's list as "Link waiting" until she relaunched. Her device now tidies
     again whenever the family's members or its link rows change. */
  console.log('\nA4b. Jo has an older Cubby; once she uses Olive\'s link it leaves Olive\'s list, while Olive\'s Cubby stays open');
  const lj = await A2.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Auntie' }));
  ok('(Olive makes a link)', !!(lj && lj.token), lj);
  await sleep(2500);
  const J = await person('jo@links.test');
  await sleep(2500);
  const joUid = await J.evaluate(() => window.LL.auth.currentUser && window.LL.auth.currentUser.uid);
  // The 866851ac client's claimInviteLink, field for field: it clears the row keyed by the token. One
  // batch, and claim-then-join when the batch is refused (rules before the claim and join were one act).
  const joJoin = await write(J, `async (db, firebase) => { const uid = '${joUid}', t = '${lj && lj.token}';
    const linkRef = db.doc('inviteLinks/' + t), hh = db.doc('households/${a.hid}');
    const upd = { joinToken: t, ['members.' + uid]: 'caregiver',
      ['memberInfo.' + uid]: { name: 'Jo', photoURL: '', role: 'caregiver', relationship: 'Auntie', joinedAt: firebase.firestore.FieldValue.serverTimestamp() },
      ['pendingLinks.' + t]: firebase.firestore.FieldValue.delete() };
    try { const b = db.batch(); b.update(linkRef, { usedBy: uid, consumed: true }); b.update(hh, upd); await b.commit(); return; }
    catch (e) { if (!e || e.code !== 'permission-denied') throw e; }
    await linkRef.update({ usedBy: uid, consumed: true });
    await hh.update(upd); }`);
  ok('Jo joins with it, the way an older Cubby does', joJoin === 'ok', joJoin);
  ok('(she is in Olive\'s family)', ((((await adminGet('households/' + a.hid)) || {}).members) || {})[joUid] === 'caregiver');
  const goneJ = await until(async () => { const h = await adminGet('households/' + a.hid); return h && !((h.pendingLinks || {})[rowKeyOf(lj)]) ? h : null; }, 15000);
  ok('the used link leaves Olive\'s list while her Cubby stays open', !!goneJ, Object.keys(((await adminGet('households/' + a.hid)) || {}).pendingLinks || {}));
  if (!OLD_MODE) ok('and so does her copy of its token', (await until(async () => (await adminGet('households/' + a.hid + '/ownerLinks/' + rowKeyOf(lj))) === null, 10000)) === true);
  await J.browserContext().close();

  console.log('\nA5. Olive removes Nina; every live link goes too, so nothing Nina ever saw still works');
  const l3 = await A2.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Cousin' }));
  ok('(Olive has a live link out)', !!(l3 && l3.token), l3);
  await sleep(1500);
  ok('Family & sharing opens', await familyOpen(A2));
  const rmN = await realTap(A2, '.ll-rm[data-uid="' + Nn.who.uid + '"]');
  ok('she taps Remove beside Nina', rmN.found && rmN.onTop, rmN);
  ok('the confirm opens', await waitSheet(A2, 'Remove Nina', 5000), await sheetText(A2));
  await sleep(400);
  ok('it says her unused links are cancelled too', /Any unused invite links are cancelled too/.test(await sheetText(A2)));
  await realTap(A2, '#sheet button', 'Remove');
  ok('Nina is removed', !!(await until(async () => { const h = await adminGet('households/' + a.hid); return h && !(h.members || {})[Nn.who.uid]; }, 10000)));
  ok('the live link is cancelled', (await until(async () => (await adminGet('inviteLinks/' + l3.token)) === null, 8000)) === true);
  ok('its row is gone', !(((await adminGet('households/' + a.hid)) || {}).pendingLinks || {})[rowKeyOf(l3)]);
  if (!OLD_MODE) ok('and her copy of its token', (await until(async () => (await adminGet('households/' + a.hid + '/ownerLinks/' + rowKeyOf(l3))) === null, 8000)) === true);
  await N.browserContext().close();

  /* ================================================================================================
     B. P4: removing someone also cancels her email invite to her other address */
  console.log('\nB. Hana joined by link with Hide My Email; Olive\'s invite to Hana\'s real address is still waiting');
  const lh = await A2.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Auntie' }));
  const Hh = await joinByLink('hana.hme@privaterelay.test', lh && lh.token);
  ok('Hana joins by link', Hh.booted && Hh.who.hid === a.hid, Hh.who);
  await nameMe(Hh.page, 'Hana');
  ok('Family & sharing opens', await familyOpen(A2));
  const inviteByForm = async (name, email) => {
    await A2.evaluate((name, email) => {
      document.getElementById('llInvName').value = name;
      document.getElementById('llInvEmail').value = email;
      document.getElementById('llInvBtn').click();
    }, name, email);
    return until(() => A2.evaluate(() => { const m = document.getElementById('llInvMsg'); return m && /Invite ready/.test(m.innerText) ? m.innerText : ''; }), 12000);
  };
  // The name as she typed it for this one, a week ago: lower case, a stray space.
  ok('Olive had invited " hana " at hana.real@links.test', !!(await inviteByForm(' hana ', 'hana.real@links.test')));
  ok('and someone else, "Hana Lee", at hanalee@links.test', !!(await inviteByForm('Hana Lee', 'hanalee@links.test')));
  ok('(both are waiting on her list)', !!(await until(async () => { const h = await adminGet('households/' + a.hid); const p = (h && h.pendingInvites) || {}; return p['hana.real@links.test'] && p['hanalee@links.test']; }, 10000)));
  await sleep(800);
  ok('Family & sharing opens again', await familyOpen(A2));
  const rmH = await realTap(A2, '.ll-rm[data-uid="' + Hh.who.uid + '"]');
  ok('she taps Remove beside Hana', rmH.found && rmH.onTop, rmH);
  ok('the confirm opens', await waitSheet(A2, 'Remove Hana', 5000), await sheetText(A2));
  await sleep(500);
  const hTxt = await sheetText(A2);
  ok('it says, naming the address, that her invite there goes too', /This also cancels your invite to hana\.real@links\.test\./.test(hTxt), hTxt);
  ok('and does not touch the other Hana\'s', !/hanalee@links\.test/.test(hTxt), hTxt);
  ok('one extra sentence, no em-dash', (hTxt.match(/This also cancels/g) || []).length === 1 && hTxt.indexOf('—') < 0, hTxt);
  // The sentence is drawn by the shared confirm sheet; check it reads, at both widths, in both themes.
  const sheetLook = (theme) => A2.evaluate((theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    const s = document.getElementById('sheet'), sub = s.querySelector('.sub');
    const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const fg = lum(rgb(getComputedStyle(sub).color)), bg = lum(rgb(getComputedStyle(s).backgroundColor));
    return { theme, sideways: s.scrollWidth - s.clientWidth, ratio: Math.round(((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)) * 100) / 100, bg: getComputedStyle(s).backgroundColor };
  }, theme);
  for (const w of [390, 320]) {
    await A2.setViewport({ width: w, height: w === 320 ? 640 : 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    for (const t of ['light', 'night']) {
      await A2.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: t === 'night' ? 'dark' : 'light' }]);
      await sleep(300);
      const look = await sheetLook(t);
      ok('at ' + w + 'px in ' + (t === 'night' ? 'Night' : 'light') + ': no sideways scroll, and the sentence reads at 4.5:1 or better', look.sideways <= 0 && look.ratio >= 4.5, look);
      await shot(A2, 'p4-remove-' + w + '-' + t);
    }
  }
  await A2.emulateMediaFeatures([]);
  const yes = await realTap(A2, '#sheet button', 'Remove');
  ok('she taps Remove (on top)', yes.found && yes.onTop, yes);
  await A2.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  ok('Hana is removed', !!(await until(async () => { const h = await adminGet('households/' + a.hid); return h && !(h.members || {})[Hh.who.uid]; }, 10000)));
  ok('her invite at her real address is cancelled', (await until(async () => (await adminGet('invites/hana.real@links.test')) === null, 8000)) === true);
  // Under rules that allow one invite per family, the form wrote this family's own invite instead.
  ok('and so is this family\'s own invite there', (await until(async () => (await adminGet('invites/hana.real@links.test/from/' + a.hid)) === null, 8000)) === true);
  ok('and its row is off Olive\'s list', !!(await until(async () => { const h = await adminGet('households/' + a.hid); return h && !((h.pendingInvites || {})['hana.real@links.test']); }, 8000)));
  const hl = await adminGet('invites/hanalee@links.test');
  ok('the other Hana\'s invite is untouched, row and all', !!hl && !!((((await adminGet('households/' + a.hid)) || {}).pendingInvites || {})['hanalee@links.test']), hl);
  await Hh.page.browserContext().close();
  // Hana signs in with her real address and tries the email join (joinByEmailInvite, field for field).
  const HR = await person('hana.real@links.test');
  await sleep(2500);
  const hrUid = await HR.evaluate(() => window.LL.auth.currentUser && window.LL.auth.currentUser.uid);
  const back = await write(HR, `(db, firebase) => { const b = db.batch(); const uid = '${hrUid}', em = 'hana.real@links.test';
    b.update(db.doc('households/${a.hid}'), new firebase.firestore.FieldPath('pendingInvites', em), firebase.firestore.FieldValue.delete(),
      'members.' + uid, 'caregiver', 'memberInfo.' + uid, { name: 'Hana', role: 'caregiver', relationship: '' });
    b.delete(db.doc('invites/' + em));
    return b.commit(); }`);
  ok('with her real address she can no longer write herself back in', back !== 'ok', back);
  ok('and she is not in Olive\'s family', !((((await adminGet('households/' + a.hid)) || {}).members || {})[hrUid]));
  await HR.browserContext().close();

  /* A sentence that names an address has to wrap it, however long it is. At 320px a 41-character
     address with nowhere to break ran off the confirm sheet, and the family list pushed its Remove and
     Cancel buttons off the card. */
  console.log('\nB2. Ida\'s invite went to an address 60 characters long, with nowhere to break it, and Olive\'s phone is 390px, then 320px wide');
  const LONG = 'ida.margaretalexandrafeatherstonehaughsmiths@longfamily.test';
  ok('(the address is 60 characters, with no hyphen or space to break at)', LONG.length === 60 && !/[-\s]/.test(LONG), LONG.length);
  ok('Family & sharing opens', await familyOpen(A2));
  ok('Olive had invited "Ida" there', !!(await inviteByForm('Ida', LONG)));
  const li = await A2.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Auntie' }));
  const Ii = await joinByLink('ida.hme@privaterelay.test', li && li.token);
  ok('Ida joins by link, with another address', Ii.booted && Ii.who.hid === a.hid, Ii.who);
  await nameMe(Ii.page, 'Ida');
  // Two ordinary people beside her. Their names and addresses fit whole at 320px once a role label
  // stacks over its Remove; wrapping "anywhere" must never be what makes them fit.
  const ORDINARY = [['sam.lee@links.test', 'Sam', 'Grandma'], ['alexandra.p@links.test', 'Alexandra Papadopoulos', 'Nanny']];
  const ordPages = [];
  for (const [em, nm, rel] of ORDINARY) {
    const lo = await A2.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Auntie' }));
    const Oj = await joinByLink(em, lo && lo.token);
    ok(nm + ' joins by link too', Oj.booted && Oj.who.hid === a.hid, Oj.who);
    await Oj.page.evaluate((nm, rel) => { const u = window.LL.auth.currentUser.uid; return window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + u + '.name']: nm, ['memberInfo.' + u + '.relationship']: rel, ['memberInfo.' + u + '.setupDone']: true }); }, nm, rel);
    ordPages.push(Oj.page);
  }
  // Words a row breaks in two: a word whose characters sit on more than one line. Only words of 24
  // characters or fewer count; a longer run has nowhere else to go at 320px.
  const brokenWords = (page, rootSel) => page.evaluate((rootSel) => {
    const out = [];
    document.querySelectorAll(rootSel).forEach((root) => {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
      while ((n = tw.nextNode())) {
        const re = /\S+/g; let m;
        while ((m = re.exec(n.nodeValue))) {
          if (m[0].length > 24) continue;
          const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
          if (new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size > 1) out.push(m[0]);
        }
      }
    });
    return out;
  }, rootSel);
  // Everything on each card stays on the card: names, addresses, labels, and the buttons to tap.
  const famLook = () => A2.evaluate(() => {
    const cards = [...document.querySelectorAll('#llModalOv .ll-mem')], out = [];
    cards.forEach((c) => {
      const r = c.getBoundingClientRect();
      c.querySelectorAll('button, .ll-mem-role, .ll-mem-email, .ll-mem-name').forEach((b) => {
        const q = b.getBoundingClientRect();
        if (q.width && (q.right > r.right + 0.5 || q.left < r.left - 0.5)) out.push({ t: b.textContent.trim().slice(0, 40), right: Math.round(q.right), card: Math.round(r.right) });
      });
    });
    return { n: cards.length, out, sideways: document.documentElement.scrollWidth - window.innerWidth,
      long: cards.some((c) => c.textContent.indexOf('ida.margaretalexandrafeatherstonehaughsmith') >= 0) };
  });
  // Both phone widths, both themes; 320px last, so Remove below is tapped on the narrowest phone.
  for (const w of [390, 320]) {
    await A2.setViewport({ width: w, height: w === 320 ? 640 : 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await sleep(1500);
    ok('Family & sharing opens again, at ' + w + 'px', await familyOpen(A2));
    for (const t of ['light', 'night']) {
      const at = 'at ' + w + 'px in ' + (t === 'night' ? 'Night' : 'light') + ': ';
      await A2.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: t === 'night' ? 'dark' : 'light' }]);
      await A2.evaluate((t) => document.documentElement.setAttribute('data-theme', t), t);
      await sleep(300);
      const fl = await famLook();
      ok(at + 'every name, address, label and button in the family list sits inside its card, and nothing scrolls sideways',
        fl.n >= 3 && fl.long && fl.out.length === 0 && fl.sideways <= 0, fl);
      const shown = await A2.evaluate((names) => names.filter((s) => [...document.querySelectorAll('#llModalOv .ll-mem')].some((c) => c.textContent.indexOf(s) >= 0)).length,
        ['sam.lee@links.test', 'Alexandra Papadopoulos', 'alexandra.p@links.test']);
      const broken = await brokenWords(A2, '#llModalOv .ll-mem');
      ok(at + 'Sam\'s and Alexandra\'s names and addresses are whole, never broken mid-word',
        shown === 3 && broken.length === 0, { shown, broken });
      if (w === 320 && t === 'light') {
        // The matcher can go red: a copy of Sam's address squeezed into 40px is found broken.
        await A2.evaluate(() => { const c = document.querySelector('#llModalOv .ll-mem'); const d = document.createElement('div'); d.id = 'v2b2Squeeze'; d.className = 'll-mem-email'; d.style.cssText = 'width:40px;overflow-wrap:anywhere'; d.textContent = 'sam.lee@links.test'; c.appendChild(d); });
        const staged = await brokenWords(A2, '#v2b2Squeeze');
        await A2.evaluate(() => { const d = document.getElementById('v2b2Squeeze'); if (d) d.remove(); });
        ok('(the same matcher finds an address squeezed into 40px broken)', staged.includes('sam.lee@links.test'), staged);
      }
      await shot(A2, 'b2-family-' + w + '-' + t);
      await A2.evaluate(() => { const c = [...document.querySelectorAll('#llModalOv .ll-mem')].find((x) => x.textContent.indexOf('ida.margaret') >= 0 && !x.querySelector('.ll-mem-av')); if (c) c.scrollIntoView({ block: 'center' }); });
      await shot(A2, 'b2-invite-' + w + '-' + t);
    }
  }
  const rmI = await realTap(A2, '.ll-rm[data-uid="' + Ii.who.uid + '"]');
  ok('she taps Remove beside Ida, all of it on screen', rmI.found && rmI.onTop, rmI);
  ok('the confirm opens', await waitSheet(A2, 'Remove Ida', 5000), await sheetText(A2));
  await sleep(500);
  ok('it names the long address', (await sheetText(A2)).indexOf(LONG) >= 0, await sheetText(A2));
  for (const w of [320, 390]) {
    await A2.setViewport({ width: w, height: w === 320 ? 640 : 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    for (const t of ['light', 'night']) {
      await A2.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: t === 'night' ? 'dark' : 'light' }]);
      await A2.evaluate((t) => document.documentElement.setAttribute('data-theme', t), t);
      await sleep(300);
      const look = await A2.evaluate(() => {
        const s = document.getElementById('sheet'), sr = s.getBoundingClientRect(), subs = [...s.querySelectorAll('.sub')];
        return { sheet: s.scrollWidth - s.clientWidth, sub: Math.max(0, ...subs.map((x) => x.scrollWidth - x.clientWidth)),
          outside: subs.some((x) => x.getBoundingClientRect().right > sr.right + 0.5), page: document.documentElement.scrollWidth - window.innerWidth };
      });
      ok('at ' + w + 'px in ' + (t === 'night' ? 'Night' : 'light') + ': the sentence wraps the address, with no sideways scroll',
        look.sheet <= 0 && look.sub <= 0 && !look.outside && look.page <= 0, look);
      await shot(A2, 'b2-remove-' + w + '-' + t);
    }
  }
  await A2.emulateMediaFeatures([]);
  const keep = await realTap(A2, '#sheet button', 'Keep');
  ok('she taps Keep', keep.found && keep.onTop, keep);
  await sleep(800);
  ok('and Ida stays, with her invite', ((((await adminGet('households/' + a.hid)) || {}).members) || {})[Ii.who.uid] === 'caregiver' && !!(await adminGet('invites/' + LONG)));
  await A2.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await Ii.page.browserContext().close();
  for (const p of ordPages) await p.browserContext().close();

  /* ================================================================================================
     C. D4: two deletions at once */
  // Hold a phone to the family it last saw, as it is in the instant before the other phone's write
  // reaches it (the race): the snapshot that would correct it simply has not arrived yet.
  const holdView = (page) => page.evaluate(() => {
    const m = JSON.parse(JSON.stringify(window.LL.members || {})), mi = JSON.parse(JSON.stringify(window.LL.memberInfo || {}));
    Object.defineProperty(window.LL, 'members', { get: () => m, set: () => {}, configurable: true });
    Object.defineProperty(window.LL, 'memberInfo', { get: () => mi, set: () => {}, configurable: true });
    return Object.keys(m);
  });
  const deleteMe = (page) => page.evaluate(() => window.LL.deleteAccount().then(() => 'ok', (e) => (e && (e.code || e.message)) || String(e)));
  const fam = (hid, owner, ownerName, other, otherRole, otherName, otherRel) => adminSet('households/' + hid, { ownerId: owner,
    members: { [owner]: 'owner', [other]: otherRole }, memberInfo: { [owner]: { name: ownerName, role: 'owner', relationship: 'Mama Bear', setupDone: true },
      [other]: { name: otherName, role: otherRole, relationship: otherRel, setupDone: true } }, app: { babies: [] } });
  const flaggedForServerMonth = (h, by) => {
    const days = h && typeof h.deleteAfter === 'number' ? (h.deleteAfter - Date.now()) / DAY : null;
    return { okay: !!h && Object.keys(h.members || {}).length === 0 && h.deletionRequestedBy === by && days !== null && days > 29.5 && days < 30.5,
      seen: h && { members: h.members, ownerId: h.ownerId, by: h.deletionRequestedBy, days } };
  };

  console.log('\nC1. Oona (owner) and Hal (her heir, Papa Bear) delete their accounts at once; Hal\'s lands first');
  await fam('HRACE1', 'ra-oona', 'Oona', 'ra-hal', 'caregiver', 'Hal', 'Papa Bear');
  await adminSet('users/ra-oona', { householdId: 'HRACE1' });
  await adminSet('users/ra-hal', { householdId: 'HRACE1' });
  const Oo = await person('oona@links.test', { uid: 'ra-oona' });
  const Ho = await person('hal@links.test', { uid: 'ra-hal' });
  ok('both boot into the family', (await booted(Oo, 45000)) && (await booted(Ho, 45000)) && (await who(Oo)).hid === 'HRACE1' && (await who(Ho)).hid === 'HRACE1');
  ok('(Oona\'s phone is held to the family it saw: Oona and Hal)', (await holdView(Oo)).length === 2);
  ok('Hal deletes his account', (await deleteMe(Ho)) === 'ok');
  ok('(Hal is gone from the family on the server)', !(((await adminGet('households/HRACE1')) || {}).members || {})['ra-hal']);
  const od = await deleteMe(Oo);
  ok('then Oona deletes hers, and it finishes', od === 'ok', od);
  const r1 = flaggedForServerMonth(await adminGet('households/HRACE1'), 'ra-oona');
  ok('the family is left with nobody in it and its deletion scheduled 30 days out by the server\'s clock, not handed to Hal', r1.okay, r1.seen);
  await Oo.browserContext().close(); await Ho.browserContext().close();

  console.log('\nC2. Opal (owner) and Pat (her heir) at once; Opal\'s lands first, and Pat\'s phone is 25 days slow');
  await fam('HRACE2', 'ra-opal', 'Opal', 'ra-pat', 'caregiver', 'Pat', 'Papa Bear');
  await adminSet('users/ra-opal', { householdId: 'HRACE2' });
  await adminSet('users/ra-pat', { householdId: 'HRACE2' });
  const Op = await person('opal@links.test', { uid: 'ra-opal' });
  const Pt = await person('pat@links.test', { uid: 'ra-pat', skewMs: -25 * DAY });
  ok('both boot into the family', (await booted(Op, 45000)) && (await booted(Pt, 45000)) && (await who(Pt)).hid === 'HRACE2');
  ok('(Pat\'s clock really is 25 days slow)', (await Pt.evaluate(() => Date.now())) < Date.now() - 24 * DAY);
  ok('(Pat\'s phone is held to the family it saw: Opal the owner, Pat a caregiver)', (await holdView(Pt)).length === 2);
  ok('Opal deletes her account, handing the family to Pat', (await deleteMe(Op)) === 'ok');
  ok('(Pat is the owner on the server now)', ((((await adminGet('households/HRACE2')) || {}).members) || {})['ra-pat'] === 'owner');
  const pd = await deleteMe(Pt);
  ok('then Pat deletes his, and it finishes', pd === 'ok', pd);
  const r2 = flaggedForServerMonth(await adminGet('households/HRACE2'), 'ra-pat');
  ok('the family is scheduled for deletion, 30 days out by the server\'s clock, not left empty and unflagged', r2.okay, r2.seen);
  await Op.browserContext().close(); await Pt.browserContext().close();

  console.log('\nC3. Ola (owner) and Hugh (caregiver) at once, for real');
  await fam('HRACE3', 'ra-ola', 'Ola', 'ra-hugh', 'caregiver', 'Hugh', 'Papa Bear');
  await adminSet('users/ra-ola', { householdId: 'HRACE3' });
  await adminSet('users/ra-hugh', { householdId: 'HRACE3' });
  const Ol = await person('ola@links.test', { uid: 'ra-ola' });
  const Hu = await person('hugh@links.test', { uid: 'ra-hugh' });
  ok('both boot into the family', (await booted(Ol, 45000)) && (await booted(Hu, 45000)));
  const both = await Promise.all([deleteMe(Ol), deleteMe(Hu)]);
  ok('both deletions finish', both[0] === 'ok' && both[1] === 'ok', both);
  const h3 = await adminGet('households/HRACE3');
  const r3 = flaggedForServerMonth(h3, h3 && h3.deletionRequestedBy);
  ok('nobody is left, and the deletion is scheduled by whichever of them went last', r3.okay && ['ra-ola', 'ra-hugh'].includes(h3.deletionRequestedBy), r3.seen);
  await Ol.browserContext().close(); await Hu.browserContext().close();

  /* ================================================================================================
     D. The deploy window, in one sitting. A phone that met the older rules used to keep making links
     the old way, and stopped tidying, for the rest of the session: an installed Cubby can stay open
     for days. Now every new link tries the new shape first, and a refused token listener is tried
     again on a later family snapshot. */
  console.log('\nD. Cubby is already open on Wendy\'s and Willa\'s phones when the rules that hide link tokens are published, and it stays open');
  const RULES_START = fs.readFileSync(RULES_FILE, 'utf8'), RULES_NEW = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  const RULES_BEFORE = readRulesBefore();
  ok('(the rules published before ownerLinks are at hand: ' + RULES_BEFORE_LABEL + ')', !!RULES_BEFORE && RULES_BEFORE.indexOf('ownerLinks') < 0 && RULES_NEW.indexOf('ownerLinks') >= 0);
  ok('(those rules are in place)', (await setRules(RULES_BEFORE || RULES_START)) === 200);
  await sleep(1000);
  const Wd = await person('wendy@links.test');
  ok('Wendy boots into a family of her own', await booted(Wd, 45000));
  const wd = await who(Wd);
  await settle(Wd, 'Wendy');
  const w0 = await Wd.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Auntie' }));
  const Cj = await joinByLink('cara@links.test', w0 && w0.token);
  ok('Cara joins her family as a caregiver', Cj.booted && Cj.who.hid === wd.hid && Cj.who.role === 'caregiver', Cj.who);
  const wA = await Wd.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Gran' }));
  ok('under those rules Wendy\'s next link is made the old way, keyed by its token', !!wA && wA.rowId === wA.token, wA);
  const Vl = await person('willa@links.test');
  ok('Willa boots into a family of her own', await booted(Vl, 45000));
  const vl = await who(Vl);
  await settle(Vl, 'Willa');
  const vA = await Vl.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Gran' }));
  ok('and so is Willa\'s', !!vA && vA.rowId === vA.token, vA);
  await sleep(1500);
  ok('the new rules are published; neither of them opens Cubby again', (await setRules(RULES_NEW)) === 200);
  await sleep(1500);
  const wB = await Wd.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Nanny' }));
  ok('the next link Wendy makes is keyed by a row id', !!wB && isRowId(wB.rowId) && wB.rowId !== wB.token, wB);
  const clean = await until(async () => {
    const r = await read(Cj.page, 'households/' + wd.hid), j = JSON.stringify(r.data || {});
    return r.exists && !hasTok(j, wB && wB.token) && !hasTok(j, wA && wA.token) ? r : null;
  }, 20000);
  ok('and Cara can read neither link\'s token on the family document: the one made before has moved too', !!clean,
    Object.keys(((await adminGet('households/' + wd.hid)) || {}).pendingLinks || {}));
  // Willa makes nothing. Her family document changes the way it does all day (someone edits a label).
  let vMoved = null;
  for (let i = 0; i < 25 && !vMoved; i++) {
    // A uid can start with a digit, which a field path must quote.
    await adminPatch('households/' + vl.hid, { memberInfo: { [vl.uid]: { relationship: i % 2 ? 'Mum' : 'Mama Bear' } } }, ['memberInfo.`' + vl.uid + '`.relationship']);
    await sleep(3000);
    const h = await adminGet('households/' + vl.hid);
    if (h && !((h.pendingLinks || {})[vA && vA.token])) vMoved = h;
  }
  ok('Willa makes no link at all, and once her family document changes her phone moves the old row off it', !!vMoved,
    Object.keys(((await adminGet('households/' + vl.hid)) || {}).pendingLinks || {}));
  const vLk = vA && await adminGet('inviteLinks/' + vA.token);
  const vCopy = vLk && isRowId(vLk.rowId) && await adminGet('households/' + vl.hid + '/ownerLinks/' + vLk.rowId);
  ok('her link learned its row id, and her copy of its token is in place', !!vCopy && vCopy.token === vA.token, { rowId: vLk && vLk.rowId, copy: vCopy });
  ok('(the rules the run started with are back)', (await setRules(RULES_START)) === 200);
  await Wd.browserContext().close(); await Cj.page.browserContext().close(); await Vl.browserContext().close();

  ok('no page errors on any phone', errs.length === 0, errs.slice(0, 4));
  ok('nothing off localhost was ever answered', offHostAnswered.length === 0, [...new Set(offHostAnswered)]);

  await browser.close();
  serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('LINKS-LEAVE: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
