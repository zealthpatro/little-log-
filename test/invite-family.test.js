/* Email invites, end to end, with the REAL rules enforced. Lane C, November 2026: D3, P1 and P5.
 *
 *   D3  invites/{email} was keyed only by the address, so another family's owner could hold a
 *       person's invite slot and her real family was told "Cubby couldn't make an invite for that
 *       address". Each family now writes its own (invites/{email}/from/{hid}); a newcomer invited by
 *       several families is asked about each in turn, most recent first, on the same sheet.
 *   P1  after a newcomer tapped "Start my own Cubby", her invite was gone but the owner's circle kept
 *       saying "Invited · waiting" until she tapped Cancel. The owner's circle now checks each of the
 *       family's own invites and says "Not joined yet", with "Invite again".
 *   P5  someone who already has a Cubby was warned she would "switch for good" even when her own was
 *       brand new and empty. When it is empty she is told nothing is left behind instead. Each thing
 *       that would be left behind keeps the warning, and each has its own case: a baby (4b), a log
 *       older than the app loads first (4c), someone else in it (4d), a note of her own (4e).
 * Round 2 (the verifier's findings on the above):
 *   F2  (3b) a Cancel made before the server answered the invite brought its row back as "Not joined
 *       yet", with "Invite again". The answer now marks a row only if no Cancel came after it.
 *   F1  (3c) an owner's second device, still on the 866851ac build, cancelled an invite and was told it
 *       was gone, while this family's own invite stayed live and her guest walked in. The per-family
 *       door now needs her row on the owner's list, which every build clears.
 *   F3  (3d) one account could put any number of invites, dated ahead, in front of a person's real one,
 *       and a newcomer had to answer every one before she reached a Cubby. The dates are the server's
 *       now (the rules half), and a newcomer is asked about three at most (the client half); the rest
 *       are offered once she is in.
 * Round 3:
 *   N1  (3e) a co-owner invite the older build cancelled and sent again as a caregiver joined him as
 *       the co-owner she withdrew. The newer of a family's two invites now says the role (the client
 *       half), and the per-family door joins only at the role her row states (the rules half,
 *       test/invite-family-rules.test.js section 8).
 *   N2  (3f, 3g) a Cancel made while Cubby was still asking the server which invite to write was
 *       undone when the answer came: the invite was written after it, and under the older rules, or
 *       on a phone with no answer, the invitee could join. The answer now finds the Cancel and writes
 *       nothing; "Invite again" says nothing is ready. 3f runs under both rule sets.
 *
 * Same harness as test/invite-consent.test.js: the real Firebase Auth SDK against the Auth emulator,
 * so every write carries a real (emulator) ID token and the Firestore emulator enforces the rules.
 * Every account is made verified, as every real sign-in is. Chrome resolves nothing but localhost.
 *
 *   node test/invite-family.test.js                        (rules = ./firestore.rules)
 *   RULES_FILE=/tmp/r365.rules node test/invite-family.test.js
 *       the deploy window: THIS client under the rules live before this change. Every invite must
 *       still be made, shown, joined, declined and cancelled through the address-keyed path, with
 *       nothing stranded. The per-family cases are skipped there (the rules are what allows them).
 *
 * Ports: FS_PORT, AUTH_PORT, WEB_PORT, and the emulator's HUB_PORT, LOG_PORT and WS_PORT.
 * SHOT_DIR=<dir> saves screenshots of the new rows and sheets at 390 and 320, light and Night.
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
const EXEC_PROJECT = 'demo-cubby-family';
const PAGE_PROJECT = 'little-log-a9caa'; // the id app/firebase-init.js gives the SDK; emulator only
const RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'firestore.rules');
const OLD_MODE = !!process.env.RULES_FILE;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = 'emulator-only-pw-family';
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
if (!process.env.INVITE_FAMILY_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-family-'));
  fs.copyFileSync(RULES_FILE, path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { INVITE_FAMILY_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
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

/* ---------- emulator admin access (bypasses the rules; reads back what really landed) ---------- */
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
  console.log('\nemail invites, one per family, with the real rules (' + (OLD_MODE ? 'OLDER rules: ' + RULES_FILE : 'firestore.rules') + ')\n');
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
  const TOASTS = () => {
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => {
      try { const t = window.toast; if (typeof t === 'function' && !t.__w) { const w = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; w.__w = 1; window.toast = w; } } catch (e) {}
    });
  };
  // existing: the account is already made (a second phone for someone who is already in).
  const person = async (email, query, existing) => {
    const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(email + ': ' + e.message));
    page.on('response', (rs) => { try { const h = new URL(rs.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHostAnswered.push(h); } catch (e) {} });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(TOASTS);
    await page.goto(appUrl(query), { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForFunction(() => !!(window.LL && window.LL.auth && window.LL.auth.signInWithEmailAndPassword), { timeout: 20000 });
    if (!existing) await makeAccount(email);
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
  const sheetText = (page) => page.evaluate(() => { const s = document.getElementById('sheet'); return s && s.classList.contains('show') ? s.innerText : ''; });
  const sheetButtons = (page) => page.evaluate(() => [...document.querySelectorAll('#sheet.show button')].map((b) => b.textContent.trim()).filter((t) => t && t !== '×' && t !== '‹'));
  const waitSheet = async (page, re, ms) => {
    try { await page.waitForFunction((src) => { const s = document.getElementById('sheet'); return !!(s && s.classList.contains('show') && new RegExp(src, 'i').test(s.innerText)); }, { timeout: ms || 20000 }, re); return true; }
    catch (e) { return false; }
  };
  const tap = (page, label) => page.evaluate((l) => {
    const b = [...document.querySelectorAll('#sheet button')].find((x) => x.textContent.trim() === l);
    if (!b) return false; b.click(); return true;
  }, label);
  const toasts = (page) => page.evaluate(() => (window.__toasts || []).slice());
  const shot = async (page, name) => { if (process.env.SHOT_DIR) { await sleep(500); await page.screenshot({ path: path.join(process.env.SHOT_DIR, name + '.png') }); } };
  /* Past the first-run steps (a name, setupDone). baby: also a baby. Written to the family's own
     record in one update and then waited for on this phone: a baby set in local state and persisted
     while the first-run snapshot is still landing was replaced by the empty blob that snapshot
     carried, so "has a baby" has to be read back, not assumed. */
  const settle = async (page, name, baby) => {
    const r = await page.evaluate((name, baby) => {
      const uid = window.LL.auth.currentUser.uid;
      const upd = { ['memberInfo.' + uid + '.setupDone']: true, ['memberInfo.' + uid + '.name']: name };
      if (baby) upd['app.babies'] = [{ id: 'b' + Math.random().toString(36).slice(2, 7), name: 'Pip', birth: Date.now() - 40 * 86400000, sex: 'M', routines: [], doctors: [], allergies: [] }];
      return window.LL.db.doc('households/' + window.LL.householdId).update(upd).then(() => 'ok', (e) => e && e.code);
    }, name, !!baby);
    if (r !== 'ok') throw new Error('settle ' + name + ': ' + r);
    if (baby) await until(() => page.evaluate(() => (state.babies || []).length === 1), 8000);
    await sleep(1200);
  };
  const familyOpen = async (page) => {
    await page.evaluate(() => window.openFamily(''));
    try { await page.waitForSelector('#llModalOv .ll-mems', { timeout: 8000 }); return true; } catch (e) { return false; }
  };
  const familyClose = (page) => page.evaluate(() => { try { document.getElementById('llModalOv').remove(); } catch (e) {} });
  // Invite through the real form, exactly as an owner does (submitInvite). owner: tick "Co-owner".
  const uiInvite = async (page, email, name, owner) => {
    if (!(await familyOpen(page))) return 'no family sheet';
    await page.evaluate((email, name, owner) => {
      document.getElementById('llInvName').value = name || '';
      document.getElementById('llInvEmail').value = email;
      document.getElementById('llInvOwner').checked = !!owner;
      document.getElementById('llInvBtn').click();
    }, email, name, !!owner);
    const m = await until(() => page.evaluate(() => { const el = document.getElementById('llInvMsg'); return el && el.innerText.trim() ? el.innerText.trim() : ''; }), 12000);
    await familyClose(page);
    return m || '';
  };
  /* A pending email row on the open circle screen, matched by its address shown in .ll-mem-email
     (whole text, never a substring), in a shape both the old and the new markup have. */
  const pendRow = (page, email) => page.evaluate((em) => {
    const row = [...document.querySelectorAll('#llModalOv .ll-mem')].find((r) => { const e = r.querySelector('.ll-mem-email'); return e && e.textContent.trim() === em; });
    if (!row) return null;
    const role = row.querySelector('.ll-mem-role');
    return { status: role ? role.textContent.trim() : '', buttons: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()),
      heights: [...row.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().height)) };
  }, email);
  // The contrast of the status and every button on a pending row against the row itself.
  const rowContrast = (page, email) => page.evaluate((em) => {
    const row = [...document.querySelectorAll('#llModalOv .ll-mem')].find((r) => { const e = r.querySelector('.ll-mem-email'); return e && e.textContent.trim() === em; });
    if (!row) return null;
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const bg = lum(rgb(getComputedStyle(row).backgroundColor));
    return [...row.querySelectorAll('.ll-mem-role, button')].map((el) => { const c = lum(rgb(getComputedStyle(el).color));
      return { t: el.textContent.trim(), r: Math.round(((Math.max(c, bg) + 0.05) / (Math.min(c, bg) + 0.05)) * 100) / 100 }; });
  }, email);
  const waitStatus = async (page, email, status, ms) => {
    const r = await until(async () => { const x = await pendRow(page, email); return x && x.status === status ? x : null; }, ms || 8000);
    return r || (await pendRow(page, email));
  };
  const tapRowButton = (page, email, label) => page.evaluate((em, l) => {
    const row = [...document.querySelectorAll('#llModalOv .ll-mem')].find((r) => { const e = r.querySelector('.ll-mem-email'); return e && e.textContent.trim() === em; });
    const b = row && [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === l);
    if (!b) return false; b.click(); return true;
  }, email, label);
  const legacyInviteAs = (page, email, rel) => page.evaluate((email, rel) => {
    /* The shape an older build writes: the address-keyed invite, and a mirror row with no perFamily
       mark. The 866851ac client and every build before it write exactly this. */
    const u = window.LL.auth.currentUser;
    return Promise.all([
      window.LL.db.collection('invites').doc(email).set({ householdId: window.LL.householdId, role: 'caregiver', relationship: rel, name: '',
        invitedBy: u.uid, status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp(), fromEmail: u.email.toLowerCase(), invitedByName: u.email.split('@')[0] }),
      window.LL.db.doc('households/' + window.LL.householdId).update(new firebase.firestore.FieldPath('pendingInvites', email), { name: '', relationship: rel, role: 'caregiver', at: Date.now() }),
    ]).then(() => 'ok', (e) => e && e.code);
  }, email, rel);
  // The app follows the phone's light or dark setting unless she picked one, and paints it on both
  // <html> and <body>: so the screenshots set the phone's setting, and both attributes.
  const night = async (page, on) => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }]);
    await page.evaluate((on) => { const v = on ? 'night' : 'light'; document.documentElement.setAttribute('data-theme', v); document.body.setAttribute('data-theme', v); }, on);
    await sleep(300);
  };
  /* createEmailInvite asks the server which invite to write (a read of this family's own invite) before
     it writes either. A slow connection holds that question open. This holds exactly that one read on
     the page, until the test lets it go: the next server read of invites/<email>/from/... after
     holdProbe() is the question, since nothing else reads that path for an address with no row yet.
     mode 'late': it is then asked for real (the rules answer). 'unavailable': no answer at all, as on
     a phone that cannot reach the server. releaseProbe() resolves once the client has acted on the
     answer and every write it queued has reached the server. */
  const holdProbe = (page, email, mode) => page.evaluate((email, mode) => {
    if (!window.__probeWrapped) {
      window.__probeWrapped = true;
      const proto = firebase.firestore.DocumentReference.prototype, orig = proto.get;
      proto.get = function (opts) {
        const want = window.__holdProbe;
        if (want && opts && opts.source === 'server' && this.path.indexOf('invites/' + want.email + '/from/') === 0) {
          window.__holdProbe = null;
          window.__probeHeld = (window.__probeHeld || 0) + 1;
          const self = this;
          let go;
          const gate = new Promise((r) => { go = r; });
          window.__releaseProbe = go;
          const out = gate.then(() => (want.mode === 'unavailable'
            ? Promise.reject(Object.assign(new Error('unavailable'), { code: 'unavailable' }))
            : orig.call(self, opts)));
          window.__probeSettled = out.then(() => 'answered', (e) => (e && e.code) || 'no answer');
          return out;
        }
        return orig.apply(this, arguments);
      };
    }
    window.__probeHeld = 0;
    window.__holdProbe = { email, mode };
  }, email, mode);
  const probeHeld = (page) => page.evaluate(() => window.__probeHeld || 0);
  const releaseProbe = (page) => page.evaluate(async () => {
    window.__releaseProbe();
    const r = await window.__probeSettled;
    await new Promise((res) => setTimeout(res, 300));
    await window.LL.db.waitForPendingWrites();
    return r;
  });
  const adminDelete = (p) => fetch(FS_DOCS + p, { method: 'DELETE', headers: ADMIN }).then((r) => r.status);
  const rowOnServer = async (hid, email) => ((((await adminGet('households/' + hid)) || {}).pendingInvites) || {})[email];
  const memberOf = async (hid, uid) => Object.keys((((await adminGet('households/' + hid)) || {}).members) || {}).includes(uid);
  // A newcomer signs in; if she is asked about an invite she joins it. Settles once she is in somewhere
  // or has been told the invite is no longer open.
  const signInAndJoin = async (email) => {
    const K = await person(email);
    const asked = await waitSheet(K, 'invited', 12000);
    if (asked) await tap(K, 'Join the family');
    await until(async () => { try { return (await who(K)).hid || (await K.evaluate(() => !!document.getElementById('ll-invite-mismatch'))); } catch (e) { return false; } }, 30000);
    if ((await who(K)).hid) await booted(K, 45000);
    await sleep(1500);
    return { page: K, asked, me: await who(K) };
  };

  /* ---- the owners ---- */
  console.log('the owners');
  const A = await person('olive@fam.test');
  ok('Olive boots into a family of her own', await booted(A));
  const a = await who(A);
  await settle(A, 'Olive', true);
  const B = await person('bea@fam.test');
  ok('Bea boots into another family', await booted(B));
  const b = await who(B);
  await settle(B, 'Bea', true);
  const Cl = await person('cleo@fam.test');
  ok('Cleo boots into a third', await booted(Cl));
  const c = await who(Cl);
  await settle(Cl, 'Cleo', true);

  if (!OLD_MODE) {
    /* ---- 1. D3: another family holding the address does not block this one ---- */
    console.log('\n1. Bea holds Nina\'s address first; Olive invites Nina anyway');
    const cm = await uiInvite(Cl, 'nina@fam.test', 'Nina');
    ok('Cleo invites Nina, first of the three', /Invite ready/.test(cm), cm);
    await sleep(400);
    ok('Bea\'s older build writes the address-keyed invite to Nina, holding that slot', (await legacyInviteAs(B, 'nina@fam.test', 'Auntie')) === 'ok');
    await sleep(400);
    const om = await uiInvite(A, 'nina@fam.test', 'Nina');
    ok('Olive invites Nina through the form, and it is ready', /Invite ready/.test(om), om);
    ok('Olive is NOT told Cubby could not make it', !/couldn’t make an invite/.test(om), om);
    ok('Olive\'s own family\'s invite is in (invites/nina/from/A)', ((await adminGet('invites/nina@fam.test/from/' + a.hid)) || {}).householdId === a.hid);
    ok('Bea\'s address-keyed invite is untouched', ((await adminGet('invites/nina@fam.test')) || {}).householdId === b.hid);
    const rowA = await until(async () => (((await adminGet('households/' + a.hid)) || {}).pendingInvites || {})['nina@fam.test'], 6000);
    ok('Olive\'s row is marked as her family\'s own invite once the server had it', !!rowA && rowA.perFamily === true, rowA);

    /* ---- 2. a newcomer invited by three families is asked about each, most recent first ---- */
    console.log('\n2. Nina, new, invited by Cleo, then Bea, then Olive');
    const N = await person('nina@fam.test');
    ok('she is shown the question', await waitSheet(N, 'invited'));
    const t1 = await sheetText(N);
    ok('the first is the most recent: Olive\'s', /From\s*olive@fam\.test/.test(t1), t1);
    ok('and saying no to it is "Not this one"', (await sheetButtons(N)).join('|') === 'Join the family|Not this one', await sheetButtons(N));
    if (process.env.SHOT_DIR) { await sleep(600); await night(N, false); await shot(N, 'multi-sheet-390-light'); await night(N, true); await shot(N, 'multi-sheet-390-night'); await N.setViewport({ width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); await shot(N, 'multi-sheet-320-night'); await night(N, false); await shot(N, 'multi-sheet-320-light'); await N.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); }
    ok('she taps Not this one', await tap(N, 'Not this one'));
    ok('she is asked about the next', await until(async () => /From\s*bea@fam\.test/.test(await sheetText(N)), 8000), await sheetText(N));
    ok('Olive\'s invite, and only Olive\'s, is gone', (await until(async () => (await adminGet('invites/nina@fam.test/from/' + a.hid)) === null, 6000)) === true);
    ok('Bea\'s is still there', ((await adminGet('invites/nina@fam.test')) || {}).householdId === b.hid);
    ok('Cleo\'s is still there', ((await adminGet('invites/nina@fam.test/from/' + c.hid)) || {}).householdId === c.hid);
    ok('Bea\'s, second, is also "Not this one"', (await sheetButtons(N)).join('|') === 'Join the family|Not this one', await sheetButtons(N));
    ok('she taps Not this one again', await tap(N, 'Not this one'));
    ok('she is asked about the last, Cleo\'s, the oldest', await until(async () => /From\s*cleo@fam\.test/.test(await sheetText(N)), 8000), await sheetText(N));
    ok('the last says "Start my own Cubby", as a single invite always has', (await sheetButtons(N)).join('|') === 'Join the family|Start my own Cubby', await sheetButtons(N));
    ok('nothing is written while she decides: she is in no family', !(await who(N)).hid);
    ok('she taps Join the family', await tap(N, 'Join the family'));
    ok('she boots', await booted(N, 45000));
    const n = await who(N);
    ok('into Cleo\'s family, as a caregiver', n.hid === c.hid && n.role === 'caregiver', n);
    ok('Cleo\'s invite was spent by the join', (await adminGet('invites/nina@fam.test/from/' + c.hid)) === null);
    ok('Bea\'s, declined, is gone too', (await adminGet('invites/nina@fam.test')) === null);
    ok('and her row left Cleo\'s list', !(((await adminGet('households/' + c.hid)) || {}).pendingInvites || {})['nina@fam.test']);

    /* ---- 3. P1: the owner's circle says what happened ---- */
    console.log('\n3. Olive opens Family & sharing after Nina said no to her');
    ok('Olive invites Dora too, who has not opened Cubby yet', /Invite ready/.test(await uiInvite(A, 'dora@fam.test', 'Dora')));
    ok('and Lena from an older build (address-keyed, unmarked row)', (await legacyInviteAs(A, 'lena@fam.test', 'Granny')) === 'ok');
    ok('and Lia the same way, who has not answered yet', (await legacyInviteAs(A, 'lia@fam.test', 'Nanny')) === 'ok');
    const L = await person('lena@fam.test');
    ok('Lena is asked', await waitSheet(L, 'invited'));
    ok('Lena taps Start my own Cubby', await tap(L, 'Start my own Cubby'));
    ok('and boots into her own', (await booted(L, 45000)) && (await who(L)).hid !== a.hid);
    ok('(Lena\'s address-keyed invite is gone)', (await until(async () => (await adminGet('invites/lena@fam.test')) === null, 6000)) === true);
    ok('Family & sharing opens', await familyOpen(A));
    const nr = await waitStatus(A, 'nina@fam.test', 'Not joined yet');
    ok('Nina\'s row says "Not joined yet"', !!nr && nr.status === 'Not joined yet', nr);
    ok('with one button to invite again, and Cancel', !!nr && nr.buttons.join('|') === 'Invite again|Cancel', nr);
    ok('both 44px tall', !!nr && nr.heights.every((h) => h >= 44), nr);
    await sleep(1500);
    const dr = await pendRow(A, 'dora@fam.test');
    ok('(companion) Dora\'s, still there, says "Invited · waiting"', !!dr && dr.status === 'Invited · waiting', dr);
    ok('with Cancel only', !!dr && dr.buttons.join('|') === 'Cancel', dr);
    const lr = await pendRow(A, 'lena@fam.test');
    ok('Lena\'s address-keyed invite, which an owner cannot read, keeps today\'s row', !!lr && lr.status === 'Invited · waiting', lr);
    const liar = await pendRow(A, 'lia@fam.test');
    ok('and so does Lia\'s, which is live: an unreadable invite is never called gone', !!liar && liar.status === 'Invited · waiting', liar);
    for (const th of [false, true]) {
      await night(A, th);
      for (const em of ['nina@fam.test', 'dora@fam.test']) {
        const cs = await rowContrast(A, em);
        ok('every word on ' + em.split('@')[0] + '\'s row reads at 4.5:1 or more in ' + (th ? 'Night' : 'Light'), !!cs && cs.length > 0 && cs.every((x) => x.r >= 4.5), cs);
      }
    }
    await night(A, false);
    if (process.env.SHOT_DIR) {
      await A.evaluate(() => { const r = [...document.querySelectorAll('#llModalOv .ll-mem')].find((x) => /nina@fam/.test(x.innerText)); if (r) r.scrollIntoView({ block: 'center' }); });
      await night(A, false); await shot(A, 'circle-gone-390-light'); await night(A, true); await shot(A, 'circle-gone-390-night');
      await A.setViewport({ width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await A.evaluate(() => { const r = [...document.querySelectorAll('#llModalOv .ll-mem')].find((x) => /nina@fam/.test(x.innerText)); if (r) r.scrollIntoView({ block: 'center' }); });
      await shot(A, 'circle-gone-320-night'); await night(A, false); await shot(A, 'circle-gone-320-light');
      const sideways = await A.evaluate(() => { const o = document.querySelector('#llModalOv .ll-modal') || document.getElementById('llModalOv'); return o.scrollWidth - o.clientWidth; });
      ok('at 320px the row fits without scrolling sideways', sideways <= 0, sideways);
      await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    }
    ok('she taps Invite again', await tapRowButton(A, 'nina@fam.test', 'Invite again'));
    const again = await waitStatus(A, 'nina@fam.test', 'Invited · waiting');
    ok('the row says "Invited · waiting" again', !!again && again.status === 'Invited · waiting', again);
    ok('and the invite is really back (invites/nina/from/A)', !!(await until(() => adminGet('invites/nina@fam.test/from/' + a.hid), 6000)));
    ok('she is told it is ready', (await toasts(A)).some((t) => /^Invite ready for nina@fam\.test\.$/.test(t)), await toasts(A));
    await familyClose(A);

    /* The row whose invite is gone, cleared with the Cancel already there. */
    ok('(Olive invites Pia, who says no)', /Invite ready/.test(await uiInvite(A, 'pia2@fam.test', 'Pia')));
    const P2 = await person('pia2@fam.test');
    ok('Pia is asked', await waitSheet(P2, 'invited'));
    ok('Pia taps Start my own Cubby', await tap(P2, 'Start my own Cubby'));
    ok('(Pia\'s invite is gone)', (await until(async () => (await adminGet('invites/pia2@fam.test/from/' + a.hid)) === null, 6000)) === true);
    await P2.browserContext().close();
    ok('Family & sharing opens', await familyOpen(A));
    const pr = await waitStatus(A, 'pia2@fam.test', 'Not joined yet');
    ok('Pia\'s row says "Not joined yet"', !!pr && pr.status === 'Not joined yet', pr);
    ok('she taps Cancel on it', await tapRowButton(A, 'pia2@fam.test', 'Cancel'));
    ok('the row comes off her list', !!(await until(async () => !(((await adminGet('households/' + a.hid)) || {}).pendingInvites || {})['pia2@fam.test'], 6000)));
    ok('and off the screen', !!(await until(async () => (await pendRow(A, 'pia2@fam.test')) === null, 6000)));
    ok('with "Taken off your list."', (await toasts(A)).includes('Taken off your list.'), await toasts(A));
    await familyClose(A);

    /* ---- 3b. F2: a Cancel made before the server answered stays cancelled ---- */
    console.log('\n3b. offline, Olive invites Gus and cancels it, then invites Ivy, cancels and invites her again');
    ok('(this phone has seen the rules allow a family\'s own invite)', (await A.evaluate(() => { try { return localStorage.getItem('cubby-invite-family-rules'); } catch (e) { return null; } })) === '1');
    const offlineCancel = async (em, name) => {
      ok('offline, the form says ' + name + '\'s invite is ready', /Invite ready/.test(await uiInvite(A, em, name)));
      ok('Family & sharing opens', await familyOpen(A));
      ok(name + '\'s row is there', !!(await until(() => pendRow(A, em), 6000)));
      ok('she taps Cancel on it', await tapRowButton(A, em, 'Cancel'));
      ok('and confirms', (await waitSheet(A, 'Cancel this invite', 6000)) && (await tap(A, 'Cancel invite')));
      await sleep(7000); // past the cancel's optimistic exit: the row is off her list on this phone
      await familyClose(A);
    };
    await A.evaluate(() => window.LL.db.disableNetwork());
    await offlineCancel('gus@fam.test', 'Gus');
    await offlineCancel('ivy@fam.test', 'Ivy');
    ok('offline, she invites Ivy again, and keeps it this time', /Invite ready/.test(await uiInvite(A, 'ivy@fam.test', 'Ivy')));
    await A.evaluate(() => window.LL.db.enableNetwork());
    ok('back online, Gus\'s invite is gone, both doors', !!(await until(async () => (await adminGet('invites/gus@fam.test/from/' + a.hid)) === null && (await adminGet('invites/gus@fam.test')) === null, 12000)));
    const ivyRow = await until(async () => { const r = ((((await adminGet('households/' + a.hid)) || {}).pendingInvites) || {})['ivy@fam.test']; return r && r.perFamily === true ? r : null; }, 12000);
    ok('(companion) Ivy\'s second invite is in, and its row is marked once the server had it', !!ivyRow && !!(await adminGet('invites/ivy@fam.test/from/' + a.hid)), ivyRow);
    await sleep(2000);
    const gusRow = ((((await adminGet('households/' + a.hid)) || {}).pendingInvites) || {})['gus@fam.test'];
    ok('Gus\'s row stays off her list: the late answer does not bring it back', !gusRow, gusRow);
    ok('Family & sharing opens', await familyOpen(A));
    await sleep(2500);
    const gusDrawn = await pendRow(A, 'gus@fam.test');
    ok('and there is no row for Gus on her circle screen', gusDrawn === null, gusDrawn);
    const ivyDrawn = await pendRow(A, 'ivy@fam.test');
    ok('(companion) Ivy\'s row says "Invited · waiting"', !!ivyDrawn && ivyDrawn.status === 'Invited · waiting', ivyDrawn);
    await familyClose(A);

    /* ---- 3c. F1: the older build's Cancel closes this family's own invite too ---- */
    console.log('\n3c. Olive\'s tablet, still on the older build, cancels her invite to Rex');
    ok('Olive invites Rex from her phone', /Invite ready/.test(await uiInvite(A, 'rex@fam.test', 'Rex')));
    ok('(as her family\'s own invite)', !!(await until(() => adminGet('invites/rex@fam.test/from/' + a.hid), 6000)));
    /* The 866851ac build's Cancel, write for write (cancelInvite there): the address-keyed delete,
       refused because there is none, then the row off her list. It cannot see this family's own
       invite, so that one stays where it is. */
    const oc = await A.evaluate(async () => {
      const db = window.LL.db, hid = window.LL.householdId;
      const r1 = await db.collection('invites').doc('rex@fam.test').delete().then(() => 'ok', (e) => e && e.code);
      const r2 = await db.doc('households/' + hid).update(new firebase.firestore.FieldPath('pendingInvites', 'rex@fam.test'), firebase.firestore.FieldValue.delete()).then(() => 'ok', (e) => e && e.code);
      return [r1, r2];
    });
    ok('(the older build\'s delete is refused, so it tidies her row away)', oc[0] === 'permission-denied' && oc[1] === 'ok', oc);
    ok('(this family\'s own invite to Rex is still there, as that build leaves it)', !!(await adminGet('invites/rex@fam.test/from/' + a.hid)));
    const X = await person('rex@fam.test');
    ok('Rex is asked (his own list still shows it)', await waitSheet(X, 'invited'));
    ok('he taps Join the family', await tap(X, 'Join the family'));
    const goneShown = await until(() => X.evaluate(() => { const o = document.getElementById('ll-invite-mismatch'); return !!o && /no longer open/.test(o.innerText); }), 15000);
    ok('he is told the invite is no longer open', !!goneShown);
    const x = await who(X);
    ok('and he is NOT in Olive\'s family', x.hid !== a.hid, x);
    ok('(server) Olive\'s family has no Rex in it', !Object.keys((((await adminGet('households/' + a.hid)) || {}).members) || {}).includes(x.uid));
    ok('the dead invite is thrown away, so he is not asked again', !!(await until(async () => (await adminGet('invites/rex@fam.test/from/' + a.hid)) === null, 8000)));
    await X.browserContext().close();

    /* ---- 3d. F3: one account, many households: the dates and the number of questions ---- */
    console.log('\n3d. Mallory invites Zoe from five households of her own; Olive invites her first');
    ok('Olive invites Zoe', /Invite ready/.test(await uiInvite(A, 'zoe@fam.test', 'Zoe')));
    const M = await person('mallory@fam.test');
    ok('Mallory boots into a Cubby of her own', await booted(M));
    await settle(M, 'Mallory', false);
    const malloryInvites = (n, ahead) => M.evaluate(async (n, ahead) => {
      const u = window.LL.auth.currentUser, db = window.LL.db, out = [];
      for (let i = 0; i < n; i++) {
        try {
          const ref = db.collection('households').doc();
          window.__lastHid = ref.id;
          await ref.set({ ownerId: u.uid, members: { [u.uid]: 'owner' }, memberInfo: { [u.uid]: { name: 'M', role: 'owner' } }, app: { babies: [] }, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
          await db.collection('invites').doc('zoe@fam.test').collection('from').doc(ref.id).set({ householdId: ref.id, role: 'caregiver',
            relationship: 'Cousin ' + (ahead ? 'Z' : 'ABCD'[i]), name: 'Zoe', invitedBy: u.uid, status: 'pending', fromEmail: u.email.toLowerCase(), invitedByName: 'M',
            createdAt: ahead ? firebase.firestore.Timestamp.fromMillis(Date.now() + 365 * 86400000) : firebase.firestore.FieldValue.serverTimestamp() });
          out.push('ok');
        } catch (e) { out.push(e && e.code); }
      }
      return out;
    }, n, ahead);
    // The rules half: a date she picks herself, a year ahead, so that hers are asked first.
    const ahead = await malloryInvites(1, true);
    ok('an invite dated a year ahead, to jump the queue, is refused', ahead.join() === 'permission-denied', ahead);
    // Where it was not refused (rules without the date check), it comes out again, so the question count
    // below judges the client's limit on its own.
    if (ahead[0] === 'ok') await M.evaluate(() => window.LL.db.collection('invites').doc('zoe@fam.test').collection('from').doc(window.__lastHid).delete().catch(() => {}));
    // The client half, on its own: four more, each dated by the server and so genuinely newer than Olive's.
    const four = await malloryInvites(4, false);
    ok('(harness) four invites dated by the server, all newer than Olive\'s, as the rules allow', four.join() === 'ok,ok,ok,ok', four);
    await sleep(800);
    const Z = await person('zoe@fam.test');
    const asked = [];
    let prev = '';
    for (let i = 0; i < 6; i++) {
      const t = await until(async () => { const s = await sheetText(Z); return s && s !== prev && /invited/i.test(s) ? s : ''; }, 15000);
      if (!t) break;
      prev = t;
      const btns = (await sheetButtons(Z)).join('|');
      asked.push({ from: /olive@fam\.test/.test(t) ? 'Olive' : ((t.match(/Cousin ([A-DZ])/) || [])[1] || '?'), btns });
      if (/Start my own Cubby/.test(btns)) { await tap(Z, 'Start my own Cubby'); break; }
      if (!/Not this one/.test(btns)) break;
      await tap(Z, 'Not this one');
    }
    ok('Zoe is asked three questions before she reaches a Cubby, not five', asked.length === 3, asked);
    ok('the most recent first: D, C, B', asked.map((q) => q.from).join('') === 'DCB', asked);
    ok('the first two are "Not this one"', asked.slice(0, 2).every((q) => q.btns === 'Join the family|Not this one'), asked);
    ok('the third is "Start my own Cubby"', !!asked[2] && asked[2].btns === 'Join the family|Start my own Cubby', asked);
    ok('she boots into a Cubby of her own', (await booted(Z, 45000)) && !!(await who(Z)).hid && (await who(Z)).hid !== a.hid, await who(Z));
    const waiting = await Z.evaluate(() => [window.LL.pendingInvite].concat(window.LL.pendingInviteQueue || []).filter(Boolean)
      .map((o) => (o.fromEmail === 'olive@fam.test' ? 'Olive' : o.fromEmail + ' ' + (o.relationship || ''))));
    ok('the two she was not asked about wait in her pending list: Mallory\'s oldest, then Olive\'s', waiting.join(',') === 'mallory@fam.test Cousin A,Olive', waiting);
    ok('and are not thrown away: Olive\'s invite is still there', !!(await adminGet('invites/zoe@fam.test/from/' + a.hid)));
    await settle(Z, 'Zoe', false);
    await Z.reload({ waitUntil: 'networkidle2', timeout: 45000 });
    ok('next time she opens Cubby she is in her own first', (await booted(Z, 45000)) && (await who(Z)).hid !== a.hid);
    ok('then asked about the next, which she can put off', (await waitSheet(Z, 'invited')) && (await sheetButtons(Z)).join('|') === 'Join the family|Not now', await sheetButtons(Z));
    ok('(Mallory\'s oldest)', /mallory@fam\.test/.test(await sheetText(Z)), await sheetText(Z));
    ok('she taps Not now', await tap(Z, 'Not now'));
    ok('and is asked about Olive\'s', !!(await until(async () => /olive@fam\.test/.test(await sheetText(Z)), 8000)), await sheetText(Z));
    ok('she taps Join the family', await tap(Z, 'Join the family'));
    try { await Z.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }); } catch (e) {}
    ok('and is in Olive\'s family', (await booted(Z, 45000)) && (await who(Z)).hid === a.hid, await who(Z));
    await Z.browserContext().close(); await M.browserContext().close();

    /* ---- 3e. N1: an invite the older build withdrew does not come back at its old role ---- */
    console.log('\n3e. Olive invites Rio as a co-owner; her tablet, on the older build, cancels and invites him again as a caregiver');
    ok('Olive invites Rio as a co-owner from her phone', /Invite ready/.test(await uiInvite(A, 'rio@fam.test', 'Rio', true)));
    ok('(as her family\'s own invite, role owner)', ((await until(() => adminGet('invites/rio@fam.test/from/' + a.hid), 6000)) || {}).role === 'owner');
    /* The 866851ac build, write for write. Its Cancel (as in 3c): the address-keyed delete, refused
       because there is none, then the row. Its form (submitInvite there): the row, then the
       address-keyed invite, as a caregiver. It cannot see this family's own invite, which stays. */
    const tablet = await A.evaluate(async () => {
      const db = window.LL.db, hid = window.LL.householdId, u = window.LL.auth.currentUser, FP = firebase.firestore.FieldPath;
      const res = (p) => p.then(() => 'ok', (e) => e && e.code);
      const out = [];
      out.push(await res(db.collection('invites').doc('rio@fam.test').delete()));
      out.push(await res(db.doc('households/' + hid).update(new FP('pendingInvites', 'rio@fam.test'), firebase.firestore.FieldValue.delete())));
      out.push(await res(db.doc('households/' + hid).update(new FP('pendingInvites', 'rio@fam.test'), { name: 'Rio', relationship: '', role: 'caregiver', at: Date.now() })));
      out.push(await res(db.collection('invites').doc('rio@fam.test').set({ householdId: hid, role: 'caregiver', relationship: '', name: 'Rio', invitedBy: u.uid, status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(), fromEmail: u.email.toLowerCase(), invitedByName: 'Olive' })));
      return out;
    });
    ok('(the tablet\'s Cancel is refused and tidies the row; its new invite and row land)', tablet.join() === 'permission-denied,ok,ok,ok', tablet);
    ok('(both are there now: her own family\'s says owner, the address-keyed one caregiver)',
      ((await adminGet('invites/rio@fam.test/from/' + a.hid)) || {}).role === 'owner' && ((await adminGet('invites/rio@fam.test')) || {}).role === 'caregiver');
    const rio = await signInAndJoin('rio@fam.test');
    ok('Rio is asked', rio.asked);
    const rioRole = ((((await adminGet('households/' + a.hid)) || {}).members) || {})[rio.me.uid];
    ok('he joins Olive\'s family', rio.me.hid === a.hid && !!rioRole, { me: rio.me, rioRole });
    ok('as the caregiver her last invite said, not the co-owner she withdrew', rioRole === 'caregiver' && rio.me.role === 'caregiver', { rioRole, me: rio.me });
    ok('both of Olive\'s invites to him were spent by the join',
      (await adminGet('invites/rio@fam.test/from/' + a.hid)) === null && (await adminGet('invites/rio@fam.test')) === null);
    await rio.page.browserContext().close();
  }

  /* ---- 3f. N2: a Cancel made while Cubby is still asking which invite to write ---- */
  /* Runs under both rule sets: under the rules live before this change the answer is a refusal and
     the address-keyed invite is the one that would be written. */
  console.log('\n3f. on a slow connection, Olive cancels an invite before Cubby has written it');
  const O2 = await person('olive@fam.test', '', true);
  ok('(Olive\'s second phone boots into her family)', (await booted(O2, 45000)) && (await who(O2)).hid === a.hid);
  ok('(this phone has never heard the rules allow a family\'s own invite)', (await O2.evaluate(() => { try { return localStorage.getItem('cubby-invite-family-rules'); } catch (e) { return 'n/a'; } })) === null);
  const slowInvite = async (em, name, mode, cancel) => {
    await holdProbe(O2, em, mode);
    ok('Family & sharing opens', await familyOpen(O2));
    await O2.evaluate((em, name) => {
      document.getElementById('llInvName').value = name;
      document.getElementById('llInvEmail').value = em;
      document.getElementById('llInvBtn').click();
    }, em, name);
    // The form's own optimistic exit, six seconds on, while the question is still out.
    const fm = await until(() => O2.evaluate(() => { const el = document.getElementById('llInvMsg'); const t = el && el.innerText.trim(); return t && !/^Creating/.test(t) ? t : ''; }), 12000);
    const held = await probeHeld(O2);
    ok('the form says ' + name + '\'s invite is ready while Cubby is still asking which to write', /Invite ready/.test(fm) && held === 1, { fm, held });
    await familyClose(O2);
    if (cancel) {
      ok('Family & sharing opens again', await familyOpen(O2));
      ok(name + '\'s row is there', !!(await until(() => pendRow(O2, em), 6000)));
      ok('she taps Cancel on it', await tapRowButton(O2, em, 'Cancel'));
      ok('and confirms', (await waitSheet(O2, 'Cancel this invite', 6000)) && (await tap(O2, 'Cancel invite')));
      ok('the row comes off her list', !!(await until(async () => !(await rowOnServer(a.hid, em)), 10000)));
      await sleep(1000);
      await familyClose(O2);
    }
    const answer = await releaseProbe(O2);
    await sleep(1500);
    return { answer, fam: await adminGet('invites/' + em + '/from/' + a.hid), legacy: await adminGet('invites/' + em), row: await rowOnServer(a.hid, em) };
  };
  // No answer at all: a phone that has never heard the new rules writes the address-keyed invite,
  // which every version of the rules accepts, and nothing on that door looks at her list.
  const kim = await slowInvite('kim@fam.test', 'Kim', 'unavailable', true);
  ok('no answer, then her Cancel: no invite to Kim is left anywhere', !kim.fam && !kim.legacy, kim);
  ok('and no row for Kim on her list', !kim.row, kim.row);
  const kimIn = await signInAndJoin('kim@fam.test');
  ok('Kim is never asked about an invite Olive withdrew', !kimIn.asked);
  ok('and can NOT join Olive\'s family', !(await memberOf(a.hid, kimIn.me.uid)), { asked: kimIn.asked, me: kimIn.me });
  await kimIn.page.browserContext().close();
  const kip = await slowInvite('kip@fam.test', 'Kip', 'unavailable', false);
  ok('(companion) the same with no Cancel: the address-keyed invite to Kip IS written', !!kip.legacy && kip.legacy.householdId === a.hid, kip);
  const kipIn = await signInAndJoin('kip@fam.test');
  ok('(companion) Kip is asked, and joins through it', kipIn.asked && (await memberOf(a.hid, kipIn.me.uid)), { asked: kipIn.asked, me: kipIn.me });
  await kipIn.page.browserContext().close();
  // A late answer: the rules say which invite, after she has already cancelled.
  const kai = await slowInvite('kai@fam.test', 'Kai', 'late', true);
  ok('a late answer, after her Cancel: no invite to Kai is left anywhere', !kai.fam && !kai.legacy, kai);
  ok('and no row for Kai on her list', !kai.row, kai.row);
  const kaiIn = await signInAndJoin('kai@fam.test');
  ok('Kai is never asked about an invite Olive withdrew', !kaiIn.asked);
  ok('and can NOT join Olive\'s family', !(await memberOf(a.hid, kaiIn.me.uid)), { asked: kaiIn.asked, me: kaiIn.me });
  await kaiIn.page.browserContext().close();
  const kit = await slowInvite('kit@fam.test', 'Kit', 'late', false);
  ok('(companion) the same with no Cancel: Kit\'s invite IS written (' + (OLD_MODE ? 'address-keyed' : 'her family\'s own') + ')',
    OLD_MODE ? !!kit.legacy && kit.legacy.householdId === a.hid : !!kit.fam && kit.fam.householdId === a.hid, kit);
  await O2.browserContext().close();

  /* ---- 3g. N2: "Invite again", cancelled before Cubby has written it ---- */
  if (!OLD_MODE) {
    console.log('\n3g. Olive taps "Invite again" on a slow connection, then Cancel before the answer');
    ok('Olive invites Wes', /Invite ready/.test(await uiInvite(A, 'wes@fam.test', 'Wes')));
    const wesFam = 'invites/wes@fam.test/from/' + a.hid;
    ok('(his row is marked as her family\'s own invite)', !!(await until(async () => ((await rowOnServer(a.hid, 'wes@fam.test')) || {}).perFamily === true, 8000)));
    const wesSaysNo = async () => {
      ok('(Wes says no: his invite is gone)', (await adminDelete(wesFam)) === 200);
      ok('Family & sharing opens', await familyOpen(A));
      const r = await waitStatus(A, 'wes@fam.test', 'Not joined yet');
      ok('Wes\'s row says "Not joined yet"', !!r && r.status === 'Not joined yet', r);
    };
    const readyToasts = async () => (await toasts(A)).filter((t) => t === 'Invite ready for wes@fam.test.').length;
    await wesSaysNo();
    // The companion first: the same held answer, let go with no Cancel, makes the invite and says so.
    await holdProbe(A, 'wes@fam.test', 'late');
    const t0 = await readyToasts();
    ok('she taps Invite again', await tapRowButton(A, 'wes@fam.test', 'Invite again'));
    ok('(Cubby is still asking)', (await probeHeld(A)) === 1);
    await releaseProbe(A);
    await sleep(1000);
    ok('(companion) with no Cancel, the invite is made again', !!(await adminGet(wesFam)));
    ok('(companion) and she is told it is ready', (await readyToasts()) === t0 + 1, await toasts(A));
    await familyClose(A);
    await wesSaysNo();
    await holdProbe(A, 'wes@fam.test', 'late');
    const t1 = await readyToasts();
    ok('she taps Invite again', await tapRowButton(A, 'wes@fam.test', 'Invite again'));
    ok('(Cubby is still asking)', (await probeHeld(A)) === 1);
    ok('and then Cancel on the same row, before the answer', await tapRowButton(A, 'wes@fam.test', 'Cancel'));
    ok('the row comes off her list', !!(await until(async () => !(await rowOnServer(a.hid, 'wes@fam.test')), 8000)));
    await releaseProbe(A);
    await sleep(1500);
    ok('no invite to Wes is made after she cancelled it', !(await adminGet(wesFam)) && !(await adminGet('invites/wes@fam.test')));
    ok('she is not told an invite is ready', (await readyToasts()) === t1, await toasts(A));
    await familyClose(A);
    ok('Family & sharing opens', await familyOpen(A));
    await sleep(1500);
    const wesDrawn = await pendRow(A, 'wes@fam.test');
    ok('and there is no row for Wes on her circle screen', wesDrawn === null, wesDrawn);
    await familyClose(A);
  }

  /* ---- 4. P5: someone who already has a Cubby, empty or not ---- */
  console.log('\n4. Paul says no, then has an empty Cubby of his own when Olive invites him again');
  ok('Olive invites Paul', /Invite ready/.test(await uiInvite(A, 'paul@fam.test', 'Paul')));
  const P = await person('paul@fam.test');
  ok('Paul is asked', await waitSheet(P, 'invited'));
  ok('he taps Start my own Cubby', await tap(P, 'Start my own Cubby'));
  ok('he boots into his own', (await booted(P, 45000)) && (await who(P)).hid !== a.hid);
  const p = await who(P);
  await settle(P, 'Paul', false); // a name, and nothing else: no baby, no logs, no journey, nobody else
  ok('Olive invites him again through the form', /Invite ready/.test(await uiInvite(A, 'paul@fam.test', 'Paul')));
  await P.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  ok('he boots into his own Cubby first', (await booted(P, 45000)) && (await who(P)).hid === p.hid);
  ok('and is offered the invite', await waitSheet(P, 'invited'));
  const pt = await sheetText(P);
  ok('his own is empty, so he is told nothing is left behind', /Yours is still empty, so nothing is left behind\./.test(pt), pt);
  ok('and is NOT warned he will switch for good', !/switch for good/.test(pt), pt);
  if (process.env.SHOT_DIR) { await sleep(600); await night(P, false); await shot(P, 'empty-sheet-390-light'); await night(P, true); await shot(P, 'empty-sheet-390-night'); await P.setViewport({ width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); await shot(P, 'empty-sheet-320-night'); await night(P, false); await shot(P, 'empty-sheet-320-light'); await P.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); }
  ok('he taps Join the family', await tap(P, 'Join the family'));
  try { await P.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }); } catch (e) {}
  ok('after the reload he is in Olive\'s family', (await booted(P, 45000)) && (await who(P)).hid === a.hid, await who(P));

  console.log('\n4b. Quinn has a baby in hers');
  ok('Olive invites Quinn', /Invite ready/.test(await uiInvite(A, 'quinn@fam.test', 'Quinn')));
  const Q = await person('quinn@fam.test');
  ok('Quinn is asked', await waitSheet(Q, 'invited'));
  ok('she starts her own', await tap(Q, 'Start my own Cubby'));
  ok('and boots into it', (await booted(Q, 45000)) && (await who(Q)).hid !== a.hid);
  await settle(Q, 'Quinn', true);
  ok('(harness) her baby really is in her Cubby, on the server', ((((await adminGet('households/' + (await who(Q)).hid)) || {}).app || {}).babies || []).length === 1);
  ok('Olive invites her again', /Invite ready/.test(await uiInvite(A, 'quinn@fam.test', 'Quinn')));
  await Q.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  ok('Quinn boots into hers and is offered it', (await booted(Q, 45000)) && (await waitSheet(Q, 'invited')));
  const qt = await sheetText(Q);
  ok('(companion) with a baby in hers, she IS warned she will switch for good', /only join if you’re ready to switch for good\./.test(qt), qt);
  ok('and not told hers is empty', !/still empty/.test(qt), qt);

  console.log('\n4c. Rhea has no baby, but one log from months ago');
  ok('Olive invites Rhea', /Invite ready/.test(await uiInvite(A, 'rhea@fam.test', 'Rhea')));
  const R = await person('rhea@fam.test');
  ok('Rhea is asked', await waitSheet(R, 'invited'));
  ok('she starts her own', await tap(R, 'Start my own Cubby'));
  ok('and boots into it', (await booted(R, 45000)) && (await who(R)).hid !== a.hid);
  await settle(R, 'Rhea', false);
  const logged = await R.evaluate((day) => {
    const uid = window.LL.auth.currentUser.uid;
    return window.LL.db.doc('households/' + window.LL.householdId + '/events/old1').set({ id: 'old1', type: 'feed', time: Date.now() - 200 * day, authorId: uid })
      .then(() => 'ok', (e) => e && e.code);
  }, DAY);
  ok('(one log, 200 days old, outside the first four months the app loads)', logged === 'ok', logged);
  ok('Olive invites her again', /Invite ready/.test(await uiInvite(A, 'rhea@fam.test', 'Rhea')));
  await R.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  ok('Rhea boots into hers and is offered it', (await booted(R, 45000)) && (await waitSheet(R, 'invited')));
  const rt = await sheetText(R);
  ok('her old log counts: she IS warned she will switch for good', /switch for good/.test(rt), rt);

  console.log('\n4d. Sara has no baby and no logs, but someone else is in hers');
  ok('Olive invites Sara', /Invite ready/.test(await uiInvite(A, 'sara@fam.test', 'Sara')));
  const Sa = await person('sara@fam.test');
  ok('Sara is asked', await waitSheet(Sa, 'invited'));
  ok('she starts her own', await tap(Sa, 'Start my own Cubby'));
  ok('and boots into it', (await booted(Sa, 45000)) && (await who(Sa)).hid !== a.hid);
  await settle(Sa, 'Sara', false);
  const saLink = await Sa.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Nanny' }));
  const T = await person('tom@fam.test', '&join=' + encodeURIComponent((saLink && saLink.token) || ''));
  ok('Tom joins Sara\'s Cubby through her link', (await booted(T, 45000)) && (await who(T)).hid === (await who(Sa)).hid, await who(T));
  ok('Olive invites Sara again', /Invite ready/.test(await uiInvite(A, 'sara@fam.test', 'Sara')));
  await Sa.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  ok('Sara boots into hers and is offered it', (await booted(Sa, 45000)) && (await waitSheet(Sa, 'invited')));
  const st = await sheetText(Sa);
  ok('Tom is in hers, so she IS warned she will switch for good', /switch for good/.test(st) && !/still empty/.test(st), st);

  console.log('\n4e. Vera has no baby, no logs and nobody else, but kept a note in hers');
  ok('Olive invites Vera', /Invite ready/.test(await uiInvite(A, 'vera@fam.test', 'Vera')));
  const V = await person('vera@fam.test');
  ok('Vera is asked', await waitSheet(V, 'invited'));
  ok('she starts her own', await tap(V, 'Start my own Cubby'));
  ok('and boots into it', (await booted(V, 45000)) && (await who(V)).hid !== a.hid);
  await settle(V, 'Vera', false);
  const noted = await V.evaluate(() => {
    const uid = window.LL.auth.currentUser.uid;
    return window.LL.db.doc('households/' + window.LL.householdId + '/notes/n1').set({ createdBy: uid, createdByName: 'Vera', at: Date.now(), day: '2026-11-01', text: 'Ask about the pram', audience: uid, pinned: false })
      .then(() => 'ok', (e) => e && e.code);
  });
  ok('(one private note of her own, on the server)', noted === 'ok', noted);
  ok('Olive invites her again', /Invite ready/.test(await uiInvite(A, 'vera@fam.test', 'Vera')));
  await V.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  ok('Vera boots into hers and is offered it', (await booted(V, 45000)) && (await waitSheet(V, 'invited')));
  const vt = await sheetText(V);
  ok('her note would be left behind, so she IS warned she will switch for good', /switch for good/.test(vt) && !/still empty/.test(vt), vt);

  /* ---- 5. the deploy window: this client under the older rules ---- */
  if (OLD_MODE) {
    console.log('\n5. under the older rules, every invite still goes through the address-keyed path');
    ok('Olive\'s invites above were made (address-keyed, nothing per-family)',
      (await adminGet('invites/paul@fam.test/from/' + a.hid)) === null && (await adminGet('invites/rhea@fam.test')) !== null);
    const row = (((await adminGet('households/' + a.hid)) || {}).pendingInvites || {})['rhea@fam.test'];
    ok('and her rows carry no perFamily mark, so nobody checks on an invite they cannot read', !!row && row.perFamily !== true, row);
    ok('Olive invites Nina', /Invite ready/.test(await uiInvite(A, 'nina@fam.test', 'Nina')));
    ok('the address-keyed invite is in', ((await adminGet('invites/nina@fam.test')) || {}).householdId === a.hid);
    const N = await person('nina@fam.test');
    ok('Nina is asked, once, with "Start my own Cubby"', (await waitSheet(N, 'invited')) && (await sheetButtons(N)).join('|') === 'Join the family|Start my own Cubby', await sheetButtons(N));
    ok('she joins', (await tap(N, 'Join the family')) && (await booted(N, 45000)) && (await who(N)).hid === a.hid);
    ok('and her invite was spent', (await adminGet('invites/nina@fam.test')) === null);
    ok('Olive invites Uma, who says no', /Invite ready/.test(await uiInvite(A, 'uma@fam.test', 'Uma')));
    const U = await person('uma@fam.test');
    ok('(Uma is asked and starts her own)', (await waitSheet(U, 'invited')) && (await tap(U, 'Start my own Cubby')) && (await booted(U, 45000)));
    ok('Family & sharing opens', await familyOpen(A));
    await sleep(2000);
    const ur = await pendRow(A, 'uma@fam.test');
    ok('Uma\'s row keeps today\'s "Invited · waiting" (nothing is readable here to say otherwise)', !!ur && ur.status === 'Invited · waiting', ur);
    ok('Cancel on it tidies it away, as before', await tapRowButton(A, 'uma@fam.test', 'Cancel'));
    ok('the confirm opens', await waitSheet(A, 'Cancel this invite', 5000));
    await tap(A, 'Cancel invite');
    ok('the row comes off her list, nothing stranded', !!(await until(async () => !(((await adminGet('households/' + a.hid)) || {}).pendingInvites || {})['uma@fam.test'], 8000)));
    ok('with the honest note', (await toasts(A)).includes('That invite was already gone, so it has been tidied away.'), await toasts(A));
  }

  ok('no page errors on any phone', errs.length === 0, errs.slice(0, 3));
  ok('nothing off localhost was ever answered', offHostAnswered.length === 0, [...new Set(offHostAnswered)]);
  await browser.close();
  serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('INVITE-FAMILY: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
