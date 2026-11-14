/* Joining a family, end to end, with the REAL rules enforced. 2026-11-12 security audit, findings
 * client-m1, identity-invite-squatting, rules-invite-squat, client-m2, identity-rejoin-after-removal.
 *
 * Two things this pins down.
 *   1. A brand-new account whose address has an email invite waiting is ASKED, naming who invited
 *      her, before anything is written. It used to be joined silently, so anyone with an account
 *      could plant an invite for a stranger's address and pull her into their family on her first
 *      sign-in. Join joins; "Start my own Cubby" deletes the invite and gives her her own; tapping
 *      outside the sheet is not an answer and the question comes back.
 *   2. Every join spends its grant. The email join deletes the invite in the same batch, the link
 *      join claims and consumes the link in the same batch, and a member the owner removes cannot
 *      write themselves back in with their old token.
 *
 * WHY THIS HARNESS. ?fsemu alone stubs auth and runs with OPEN rules, which proves the client and
 * nothing about the rules. Here ?authemu runs the real Firebase Auth SDK against the Auth emulator,
 * so every write the app makes carries a real (emulator) ID token and the Firestore emulator
 * enforces firestore.rules on it. The accounts are emulator-only test accounts made in the page.
 *
 *   node test/invite-consent.test.js                      (rules = ./firestore.rules)
 *   RULES_FILE=/tmp/old.rules node test/invite-consent.test.js
 *       the deploy window: the NEW client against the OLD rules (the legitimate joins must still
 *       work there; the attack checks are skipped, because the old rules are the hole)
 *
 * Ports are overridable so it never collides with another suite: FS_PORT, AUTH_PORT, WEB_PORT, and
 * the emulator's own HUB_PORT, LOG_PORT and WS_PORT (left to the CLI's defaults when unset).
 *
 * THE ACCOUNTS ARE VERIFIED, like every real one. The rules only trust an address with
 * email_verified (firestore.rules, emailProven), and an account made in the page with a password
 * is unverified, which no Cubby sign-in ever produces. So each person is made through the Auth
 * emulator's admin endpoint with emailVerified: true and then signs in in the page. Uma (section
 * 2b) is the one unverified account, on purpose.
 *
 * Chrome is launched with downloads redirected (tools/gate_downloads.js) and every host but
 * localhost unresolvable, so nothing here can reach a real service.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FS_PORT = Number(process.env.FS_PORT) || 8697;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9697;
const WEB_PORT = Number(process.env.WEB_PORT) || 8698;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const EXEC_PROJECT = 'demo-cubby-consent';
const RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'firestore.rules');
const OLD_MODE = !!process.env.RULES_FILE;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = 'emulator-only-pw-1';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res) => {
  http.get(url, (r) => { r.resume(); res({ status: r.statusCode }); }).on('error', () => res({ status: 0 }));
});

/* ---------- outer phase: both emulators up, then re-run ourselves inside them ---------- */
if (!process.env.INVITE_CONSENT_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-consent-'));
  fs.copyFileSync(RULES_FILE, path.join(scratch, 'firestore.rules'));
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { INVITE_CONSENT_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
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

/* ---------- inner phase ---------- */
(async () => {
  console.log('\njoining a family, with the real rules (' + (OLD_MODE ? 'OLD rules: ' + RULES_FILE : 'firestore.rules') + ')\n');
  const serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
    { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(WEB_PORT) }) });
  for (let i = 0; i < 40 && (await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200; i++) await sleep(250);
  ok('the static server is serving this checkout', (await get(`http://localhost:${WEB_PORT}/app/`)).status === 200);
  // And it is THIS checkout's code, byte for byte, not some other tree's server on the same port.
  const servedStore = await fetch(`http://localhost:${WEB_PORT}/app/store-firebase.js`).then((r) => r.text()).catch(() => '');
  ok('its store-firebase.js is the one on disk here', servedStore === fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8'));

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const dl = require(path.join(ROOT, 'tools', 'gate_downloads.js'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', downloadBehavior: dl.downloadBehavior(),
    args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1'] });
  const errs = [];
  const offHost = [], offHostAnswered = [];

  /* A verified account, the way every real sign-in makes one (see the header). The emulator's admin
     endpoint takes the project the emulators were started with; GCLOUD_PROJECT is what exec sets. */
  const AUTH_PROJECT = process.env.GCLOUD_PROJECT || EXEC_PROJECT;
  const makeAccount = async (email, verified) => {
    const r = await fetch(`http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${AUTH_PROJECT}/accounts`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
      body: JSON.stringify({ email, password: PW, emailVerified: verified !== false }) });
    const j = await r.json().catch(() => ({}));
    if (!j.localId) throw new Error('could not make the emulator account for ' + email + ': ' + JSON.stringify(j).slice(0, 200));
    return j.localId;
  };
  // One isolated browser context per person, signed in in the page against the Auth emulator.
  // before(page), when given, runs in the page after load and before she signs in. unverified makes
  // the account the way a password sign-up would, with no proof of the address.
  const person = async (email, extraQuery, before, unverified) => {
    const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(email + ': ' + e.message));
    page.on('request', (rq) => { try { const h = new URL(rq.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHost.push(h); } catch (e) {} });
    page.on('response', (rs) => { try { const h = new URL(rs.url()).hostname; if (h && h !== 'localhost' && h !== '127.0.0.1') offHostAnswered.push(h); } catch (e) {} });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(`http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}${extraQuery || ''}`,
      { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForFunction(() => !!(window.LL && window.LL.auth && window.LL.auth.signInWithEmailAndPassword), { timeout: 20000 });
    if (before) await page.evaluate(before);
    if (unverified) await page.evaluate((e, p) => window.LL.auth.createUserWithEmailAndPassword(e, p).then(() => true), email, PW);
    else {
      await makeAccount(email);
      await page.evaluate((e, p) => window.LL.auth.signInWithEmailAndPassword(e, p).then(() => true), email, PW);
    }
    return page;
  };
  const tokenVerified = (page) => page.evaluate(() => window.LL.auth.currentUser.getIdTokenResult().then((t) => t.claims.email_verified === true));
  const overlayText = (page) => page.evaluate(() => { const o = document.getElementById('ll-invite-mismatch'); return o ? o.innerText : ''; });
  const onLanding = (page) => page.evaluate(() => { const o = document.getElementById('llAuthOv'); return !!(o && /Continue with Google/.test(o.innerText)); });
  const booted = async (page, ms) => {
    try {
      await page.waitForFunction(() => !!(window.LL && window.LL.householdId && typeof state !== 'undefined' && !document.getElementById('llAuthOv')),
        { timeout: ms || 30000 });
      return true;
    } catch (e) { return false; }
  };
  const who = (page) => page.evaluate(() => ({
    uid: window.LL && window.LL.auth && window.LL.auth.currentUser && window.LL.auth.currentUser.uid,
    hid: (window.LL && window.LL.householdId) || null, role: (window.LL && window.LL.role) || null,
  }));
  const sheetText = (page) => page.evaluate(() => {
    const s = document.getElementById('sheet');
    return s && s.classList.contains('show') ? s.innerText : '';
  });
  const waitSheet = async (page, ms) => {
    try { await page.waitForFunction(() => { const s = document.getElementById('sheet'); return !!(s && s.classList.contains('show') && /invited/i.test(s.innerText)); }, { timeout: ms || 20000 }); return true; }
    catch (e) { return false; }
  };
  const tap = (page, label) => page.evaluate((l) => {
    const b = [...document.querySelectorAll('#sheet button')].find((x) => x.textContent.trim() === l);
    if (!b) return false; b.click(); return true;
  }, label);
  // Read a doc as the page's signed-in user, through the app's own SDK and therefore the rules.
  const read = (page, p) => page.evaluate((p) => window.LL.db.doc(p).get().then((d) => ({ exists: d.exists, data: d.exists ? d.data() : null }),
    (e) => ({ denied: e && e.code })), p);
  const write = (page, fnSrc) => page.evaluate((src) => {
    // eslint-disable-next-line no-new-func
    return Promise.resolve().then(() => new Function('db', 'firebase', 'return (' + src + ')(db, firebase)')(window.LL.db, window.firebase))
      .then(() => 'ok', (e) => (e && e.code) || String(e));
  }, fnSrc);

  /* ---- 1. the owner ---- */
  console.log('1. the owner and her invitations');
  const A = await person('olive@cubby.test');
  ok('(harness) her token carries email_verified, as every real sign-in\'s does', await tokenVerified(A));
  ok('Olive boots into a family of her own', await booted(A));
  const a = await who(A);
  ok('as its owner', a.role === 'owner', a);
  await A.evaluate(() => window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + window.LL.auth.currentUser.uid + '.name']: 'Olive' }));
  // The invite exactly as submitInvite() writes it (store-firebase.js), plus the owner's mirror row.
  // signed=false writes the shape an older build left: no sender name and no sender address.
  const inviteFor = (email, rel, signed, byName) => A.evaluate((email, rel, signed, byName) => {
    const u = window.LL.auth.currentUser;
    const doc = { householdId: window.LL.householdId, role: 'caregiver', relationship: rel, name: '',
      invitedBy: u.uid, status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (signed !== false) { doc.fromEmail = u.email.toLowerCase(); doc.invitedByName = byName || 'Olive'; }
    return Promise.all([
      window.LL.db.collection('invites').doc(email).set(doc),
      window.LL.db.doc('households/' + window.LL.householdId).update(new firebase.firestore.FieldPath('pendingInvites', email), { name: '', relationship: rel, role: 'caregiver', at: Date.now() }),
    ]).then(() => 'ok', (e) => e && e.code);
  }, email, rel, signed, byName);
  ok('she invites Nina by email', (await inviteFor('nina@cubby.test', 'Auntie')) === 'ok');
  ok('and Paul', (await inviteFor('paul@cubby.test', 'Uncle')) === 'ok');
  ok('and Dora', (await inviteFor('dora@cubby.test', 'Granny')) === 'ok');
  const link = await A.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Nanny' }));
  ok('and mints a link for Rosa', !!(link && link.token), link);
  // Listed under its row id (lane B, D1), or under its token under older rules: section 5 checks that
  // the join clears exactly this key, which proves nothing unless the key was there first.
  const hh0 = (await read(A, 'households/' + a.hid)).data || {};
  ok('(her list shows the link under its row key)', !!((hh0.pendingLinks || {})[(link && link.rowId) || (link && link.token)]), Object.keys(hh0.pendingLinks || {}));

  /* ---- 2. a newcomer with an invite is asked, and says yes ---- */
  console.log('\n2. Nina, new, invited by email: asked first, then joins');
  const N = await person('nina@cubby.test');
  ok('she is shown the question', await waitSheet(N));
  const nt = await sheetText(N);
  // The address the rules proved comes first; the name the sender typed follows, in brackets.
  ok('naming who invited her: the address the rules proved, then the name', /From\s*olive@cubby\.test \(Olive\)/.test(nt), nt);
  ok('and what she would join as, as a label', /You’d join as\s*Auntie/.test(nt), nt);
  ok('with a way to start her own instead', /Start my own Cubby/.test(nt), nt);
  const a11y = await N.evaluate(() => { const s = document.getElementById('sheet'); const h = s.querySelector('h2');
    return { x: !!s.querySelector('.sheet-x'), focus: document.activeElement && document.activeElement.tagName,
      ring: h ? getComputedStyle(h).outlineStyle : null, ringW: h ? getComputedStyle(h).outlineWidth : null }; });
  ok('a question that needs an answer has no × that only brings it back', a11y.x === false, a11y);
  ok('and focus starts on the question', a11y.focus === 'H2', a11y);
  ok('without a focus ring drawn round the title', a11y.focus === 'H2' && a11y.ring === 'none', a11y);
  if (process.env.SHOT_DIR) { await sleep(900); await N.screenshot({ path: path.join(process.env.SHOT_DIR, 'newcomer-sheet.png') }); }
  ok('and nothing is written while she decides', (await read(A, 'households/' + a.hid)).data.members[(await who(N)).uid] === undefined);
  ok('she taps Join the family', await tap(N, 'Join the family'));
  ok('she boots', await booted(N, 45000));
  const n = await who(N);
  ok('into Olive\'s family', n.hid === a.hid, { n, a });
  ok('as a caregiver', n.role === 'caregiver', n);
  ok('her invite was spent by the join', (await read(N, 'invites/nina@cubby.test')).exists === false);
  const hh1 = (await read(A, 'households/' + a.hid)).data;
  ok('and her row left Olive\'s pending list', !('nina@cubby.test' in (hh1.pendingInvites || {})), Object.keys(hh1.pendingInvites || {}));

  // Her everyday writes as a caregiver, through the app's own save paths, under the real rules.
  const saved = await N.evaluate(() => {
    const uid = window.LL.auth.currentUser.uid;
    return window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + uid + '.name']: 'Nina', ['memberInfo.' + uid + '.relationship']: 'Auntie', ['memberInfo.' + uid + '.setupDone']: true })
      .then(() => 'ok', (e) => e && e.code);
  });
  ok('her profile save lands', saved === 'ok', saved);
  await sleep(1200); // let that snapshot settle, or it re-applies the blob over the edit below
  await N.evaluate(() => {
    state.meds = (state.meds || []).concat([{ id: 'medN1', name: 'Vitamin D', dose: '1', unit: 'drop', pattern: { type: 'daily', times: ['08:00'] } }]);
    persist();
  });
  await sleep(2000);
  const hhN = (await read(A, 'households/' + a.hid)).data;
  ok('and her blob save (a medicine) reaches Olive', ((hhN.app || {}).meds || []).some((m) => m.id === 'medN1'), (hhN.app || {}).meds);

  /* ---- 2b. an address nobody proved opens nothing ---- */
  if (!OLD_MODE) {
    console.log('\n2b. Uma: an account that never proved its address, with an invite waiting for it');
    ok('Olive invites uma@cubby.test', (await inviteFor('uma@cubby.test', 'Auntie')) === 'ok');
    const U = await person('uma@cubby.test', '', null, true);
    ok('(companion) her token really is unverified', !(await tokenVerified(U)));
    ok('she boots into a Cubby of her own', (await booted(U, 45000)) && !!(await who(U)).hid && (await who(U)).hid !== a.hid, await who(U));
    ok('she is never shown the invite', !/invited/i.test(await sheetText(U)), await sheetText(U));
    ok('the rules refuse her the invite', (await read(U, 'invites/uma@cubby.test')).denied === 'permission-denied');
    ok('she is not in Olive\'s family', !((await read(A, 'households/' + a.hid)).data.members || {})[(await who(U)).uid]);
    await U.browserContext().close();
  }

  /* ---- 2c. the sender's name is a label beside the address, never a second address or a sentence ---- */
  console.log('\n2c. what the sender typed as her own name');
  ok('Olive signs an invite to Ivy with "midwife@nhs.test" as her name', (await inviteFor('ivy@cubby.test', 'Auntie', true, 'midwife@nhs.test')) === 'ok');
  const I = await person('ivy@cubby.test');
  ok('Ivy is shown the question', await waitSheet(I));
  const it = await sheetText(I);
  ok('it names the proven address only', /From\s*olive@cubby\.test(?!\s*\()/.test(it), it);
  ok('and not the address typed as a name', !/midwife/.test(it), it);
  await I.browserContext().close();
  ok('Olive signs an invite to Gia with "Cubby. Verified family" as her name', (await inviteFor('gia@cubby.test', 'Auntie', true, 'Cubby. Verified family')) === 'ok');
  // An older page draws no facts, so they are folded into the body as text (factsAsText).
  const G = await person('gia@cubby.test', '', () => { window.confirmSheet.drawsFacts = false; });
  ok('Gia, on a page that folds the facts into the text, is shown the question', await waitSheet(G));
  const gt = await sheetText(G);
  ok('the name is cut to its first words, after the address', /From: olive@cubby\.test \(Cubby\)\./.test(gt), gt);
  ok('and the rest of the sentence the sender wrote is not on screen', !/Verified family/.test(gt), gt);
  await G.browserContext().close();

  /* ---- 3. a newcomer says no ---- */
  console.log('\n3. Paul, new, invited by email: says no');
  const P = await person('paul@cubby.test');
  ok('he is shown the question', await waitSheet(P));
  ok('he taps Start my own Cubby', await tap(P, 'Start my own Cubby'));
  ok('he boots', await booted(P, 45000));
  const p = await who(P);
  ok('into a family of his own', !!p.hid && p.hid !== a.hid, { p, a });
  ok('as its owner', p.role === 'owner', p);
  ok('the invite he declined is gone', (await read(P, 'invites/paul@cubby.test')).exists === false);
  ok('and he is not in Olive\'s family', !((await read(A, 'households/' + a.hid)).data.members || {})[p.uid]);

  /* ---- 3b. someone who already has a Cubby is still asked the old way, and her join is spent too ---- */
  console.log('\n3b. Paul, now with a Cubby of his own, is invited again and accepts');
  // Past onboarding (a baby, a name), because the offer waits until the first-run steps are done.
  await P.evaluate(() => {
    state.babies = [{ id: 'pb1', name: 'Pip', birth: Date.now() - 40 * 86400000, sex: 'M', routines: [], doctors: [], allergies: [] }];
    state.activeBabyId = 'pb1'; persist();
    return window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + window.LL.auth.currentUser.uid + '.setupDone']: true, ['memberInfo.' + window.LL.auth.currentUser.uid + '.name']: 'Paul' });
  });
  await sleep(1200);
  ok('Olive invites Paul again', (await inviteFor('paul@cubby.test', 'Uncle')) === 'ok');
  await P.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  ok('he boots into his own Cubby first', (await booted(P, 45000)) && (await who(P)).hid === p.hid);
  ok('and is offered the invite', await waitSheet(P));
  ok('he taps Join the family', await tap(P, 'Join the family'));
  try { await P.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }); } catch (e) {}
  ok('after the reload he is in Olive\'s family', (await booted(P, 45000)) && (await who(P)).hid === a.hid, await who(P));
  ok('and that invite was spent by the join too', (await read(P, 'invites/paul@cubby.test')).exists === false);

  /* ---- 4. tapping outside is not an answer ---- */
  console.log('\n4. Dora: taps outside the sheet, is asked again, then joins');
  const D = await person('dora@cubby.test');
  ok('she is shown the question', await waitSheet(D));
  await D.evaluate(() => document.getElementById('scrim').click());
  await sleep(150);
  ok('tapping outside closes it', !(await sheetText(D)));
  ok('and it comes back, because it needs an answer', await waitSheet(D, 5000));
  ok('nothing was decided for her: still no family', !(await who(D)).hid);
  ok('her invite is still there', (await read(D, 'invites/dora@cubby.test')).exists === true);
  ok('she taps Join the family', await tap(D, 'Join the family'));
  ok('she boots into Olive\'s family', (await booted(D, 45000)) && (await who(D)).hid === a.hid);

  /* ---- 5. the link ---- */
  console.log('\n5. Rosa, new, through the link: joins without a question (she followed it)');
  const R = await person('rosa@cubby.test', '&join=' + encodeURIComponent(link.token));
  ok('she boots', await booted(R, 45000));
  const r = await who(R);
  ok('into Olive\'s family', r.hid === a.hid, { r, a });
  ok('as a caregiver', r.role === 'caregiver', r);
  const hh2 = (await read(A, 'households/' + a.hid)).data;
  // The row is keyed by the link's row id now (lane B, D1), or by its token under older rules.
  ok('Olive\'s pending row for the link is gone', !((hh2.pendingLinks || {})[link.token]) && !((hh2.pendingLinks || {})[link.rowId || link.token]), hh2.pendingLinks);
  const lk = (await read(R, 'inviteLinks/' + link.token)).data || {};
  ok('the link is used AND consumed', lk.usedBy === r.uid && lk.consumed === true, lk);

  /* ---- 5b. an invite that cannot say who sent it ---- */
  console.log('\n5b. Lena, invited the way an older build wrote it: no sender at all');
  ok('Olive invites Lena from an older build', (await inviteFor('lena@cubby.test', 'Grandma', false)) === 'ok');
  const L = await person('lena@cubby.test');
  ok('she is shown the question', await waitSheet(L));
  const lt = await sheetText(L);
  ok('it says plainly the invite does not say who sent it', /doesn’t say who sent it/.test(lt), lt);
  ok('and names nobody', !/From/.test(lt) && !/Olive/.test(lt), lt);
  ok('she starts her own', await tap(L, 'Start my own Cubby'));
  ok('and boots into it', (await booted(L, 45000)) && (await who(L)).hid !== a.hid);

  /* ---- 5c. whatever the sender typed is a label, never Cubby's sentence ---- */
  console.log('\n5c. Yara: the relationship carries a sentence of its own');
  ok('Olive invites Yara as "Mum. Your partner set this up for you"', (await inviteFor('yara@cubby.test', 'Mum. Your partner set this up for you')) === 'ok');
  const Y = await person('yara@cubby.test');
  ok('she is shown the question', await waitSheet(Y));
  const yt = await sheetText(Y);
  ok('the relationship is cut to its label', /You’d join as\s*Mum\b/.test(yt), yt);
  ok('and the reassurance the sender wrote is not on screen', !/partner set this up/.test(yt), yt);
  ok('she taps Join the family', await tap(Y, 'Join the family'));
  ok('and joins as before', (await booted(Y, 45000)) && (await who(Y)).hid === a.hid);

  /* ---- 5d. withdrawn while she reads ---- */
  console.log('\n5d. Xena: Olive withdraws the invite while Xena is reading the question');
  ok('Olive invites Xena', (await inviteFor('xena@cubby.test', 'Auntie')) === 'ok');
  const X = await person('xena@cubby.test');
  ok('she is shown the question', await waitSheet(X));
  const cancelled = await A.evaluate(() => window.LL.db.collection('invites').doc('xena@cubby.test').delete().then(() => 'ok', (e) => e && e.code));
  ok('Olive cancels it', cancelled === 'ok', cancelled);
  ok('Xena taps Join the family', await tap(X, 'Join the family'));
  let xo = '';
  for (let i = 0; i < 40 && !xo; i++) { await sleep(250); xo = await overlayText(X); }
  ok('she is told the invite is no longer open', /This invite is no longer open/.test(xo), xo);
  ok('not dropped on the sign-in landing', !(await onLanding(X)));
  ok('still signed in, and in no family', !!(await who(X)).uid && !(await who(X)).hid, await who(X));
  ok('no blame on saving', !/wasn’t allowed to save/.test(xo), xo);
  await X.evaluate(() => { const b = document.getElementById('ll-im-own'); if (b) b.click(); });
  try { await X.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }); } catch (e) {}
  ok('Start my own Cubby gives her her own', (await booted(X, 45000)) && !!(await who(X)).hid && (await who(X)).hid !== a.hid, await who(X));

  /* ---- 5e. a page from an older build, paired with this store-firebase.js ---- */
  console.log('\n5e. Zoe: her page is an older build that cannot ask (no cancel hook)');
  ok('Olive invites Zoe', (await inviteFor('zoe@cubby.test', 'Auntie')) === 'ok');
  const Z = await person('zoe@cubby.test', '', () => { window.__confirmCancel = undefined; });
  ok('she is not left on a blank screen: she boots into a Cubby of her own', (await booted(Z, 45000)) && !!(await who(Z)).hid && (await who(Z)).hid !== a.hid, await who(Z));
  ok('and was never joined without being asked', !((await read(A, 'households/' + a.hid)).data.members || {})[(await who(Z)).uid]);
  ok('the invite waits to be offered after boot', await Z.evaluate(() => !!(window.LL.pendingInvite && window.LL.pendingInvite.householdId)));

  /* ---- 6. the attacks, which only the new rules close ---- */
  if (!OLD_MODE) {
    console.log('\n6. removed, Rosa tries to come back; a caregiver tries to schedule the wipe');
    const removed = await A.evaluate((uid) => window.LL.db.doc('households/' + window.LL.householdId).update({
      ['members.' + uid]: firebase.firestore.FieldValue.delete(), ['memberInfo.' + uid]: firebase.firestore.FieldValue.delete(),
      ['formerMemberInfo.' + uid]: { name: '', relationship: 'Nanny', avatar: null } }).then(() => 'ok', (e) => e && e.code), r.uid);
    ok('Olive removes Rosa', removed === 'ok', removed);
    let rGone = false;
    for (let i = 0; i < 40 && !rGone; i++) { await sleep(250); rGone = await R.evaluate(() => { const o = document.getElementById('ll-access-lost'); return !!(o && /You’re no longer in this family/.test(o.innerText)); }); }
    ok('Rosa\'s phone tells her she is no longer in this family', rGone);
    const nGone = await N.evaluate(() => !!document.getElementById('ll-access-lost'));
    ok('(companion) Nina, still in it, is told nothing of the kind', !nGone && (await who(N)).hid === a.hid, { nGone, n: await who(N) });
    const back1 = await write(R, `(db, firebase) => db.doc('households/${a.hid}').update({ joinToken: '${link.token}',
      'members.${r.uid}': 'caregiver', 'memberInfo.${r.uid}': { name: 'Rosa', role: 'caregiver', relationship: 'Nanny' } })`);
    ok('Rosa cannot write herself back in with her old token', back1 === 'permission-denied', back1);
    const back2 = await write(R, `(db, firebase) => { const b = db.batch();
      b.update(db.doc('inviteLinks/${link.token}'), { usedBy: '${r.uid}', consumed: true });
      b.update(db.doc('households/${a.hid}'), { joinToken: '${link.token}', 'members.${r.uid}': 'caregiver', 'memberInfo.${r.uid}': { name: 'Rosa', role: 'caregiver' } });
      return b.commit(); }`);
    ok('nor in a batch that re-consumes it', back2 === 'permission-denied', back2);
    const wipe = await write(N, `(db) => db.doc('households/${a.hid}').update({ deleteAfter: 1 })`);
    ok('Nina, a caregiver, cannot schedule the family for deletion', wipe === 'permission-denied', wipe);
    const hide = await write(N, `(db, firebase) => db.doc('households/${a.hid}').update({ 'memberInfo.${n.uid}': firebase.firestore.FieldValue.delete() })`);
    ok('nor hide herself from the circle while staying in it', hide === 'permission-denied', hide);
  }
  const S = await person('sam@cubby.test');
  ok('Sam, never invited, boots into a family of his own', (await booted(S, 45000)) && (await who(S)).hid !== a.hid);
  ok('the rules are live in this run: Sam cannot read Olive\'s family', (await read(S, 'households/' + a.hid)).denied === 'permission-denied');

  /* ---- 7. the last one out takes her invites with her ---- */
  console.log('\n7. Sam, the only one in his Cubby, invites Wren and makes a link, then deletes his account');
  const samInv = await S.evaluate(() => {
    const u = window.LL.auth.currentUser;
    return Promise.all([
      window.LL.db.collection('invites').doc('wren@cubby.test').set({ householdId: window.LL.householdId, role: 'caregiver', relationship: 'Nanny', name: '',
        invitedBy: u.uid, fromEmail: u.email.toLowerCase(), invitedByName: 'Sam', status: 'pending' }),
      window.LL.db.doc('households/' + window.LL.householdId).update(new firebase.firestore.FieldPath('pendingInvites', 'wren@cubby.test'), { name: '', relationship: 'Nanny', role: 'caregiver', at: Date.now() }),
    ]).then(() => 'ok', (e) => e && e.code);
  });
  ok('Sam invites Wren', samInv === 'ok', samInv);
  const samLink = await S.evaluate(() => window.LL.createInviteLink({ role: 'caregiver' }));
  ok('and makes a link', !!(samLink && samLink.token), samLink);
  const gone = await S.evaluate(() => window.LL.deleteAccount().then(() => 'ok', (e) => (e && (e.code || e.message)) || String(e)));
  ok('Sam deletes his account', gone === 'ok', gone);
  await sleep(2500);
  const W = await person('wren@cubby.test');
  ok('Wren boots into a Cubby of her own', (await booted(W, 45000)) && !!(await who(W)).hid, await who(W));
  ok('and is not asked to join a family that no longer exists', !/invited/i.test(await sheetText(W)), await sheetText(W));
  ok('Sam\'s invite to her went with him', (await read(W, 'invites/wren@cubby.test')).exists === false);
  ok('and so did his link', (await read(W, 'inviteLinks/' + samLink.token)).exists === false);
  ok('no page errors on any phone', errs.length === 0, errs.slice(0, 3));
  /* Every other host is unresolvable (--host-resolver-rules), so anything off localhost can be tried but
     never answered. The Firebase SDK's own offline probe tries www.google.com when the page goes offline. */
  ok('nothing off localhost was ever answered', offHostAnswered.length === 0, [...new Set(offHostAnswered)]);
  if (offHost.length) console.log('  ..   tried and refused by the host rules: ' + JSON.stringify([...new Set(offHost)]));

  await browser.close();
  serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('INVITE-CONSENT: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
