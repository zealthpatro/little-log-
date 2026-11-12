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
 * Ports are overridable so it never collides with another suite: FS_PORT, AUTH_PORT, WEB_PORT.
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
    emulators: { firestore: { port: FS_PORT }, auth: { port: AUTH_PORT }, ui: { enabled: false } }
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

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];

  // One isolated browser context per person, signed up in the page against the Auth emulator.
  const person = async (email, extraQuery) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(email + ': ' + e.message));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(`http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}${extraQuery || ''}`,
      { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForFunction(() => !!(window.LL && window.LL.auth && window.LL.auth.createUserWithEmailAndPassword), { timeout: 20000 });
    await page.evaluate((e, p) => window.LL.auth.createUserWithEmailAndPassword(e, p).then(() => true), email, PW);
    return page;
  };
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
  ok('Olive boots into a family of her own', await booted(A));
  const a = await who(A);
  ok('as its owner', a.role === 'owner', a);
  await A.evaluate(() => window.LL.db.doc('households/' + window.LL.householdId).update({ ['memberInfo.' + window.LL.auth.currentUser.uid + '.name']: 'Olive' }));
  // The invite exactly as submitInvite() writes it (store-firebase.js), plus the owner's mirror row.
  const inviteFor = (email, rel) => A.evaluate((email, rel) => {
    const u = window.LL.auth.currentUser;
    return Promise.all([
      window.LL.db.collection('invites').doc(email).set({ householdId: window.LL.householdId, role: 'caregiver', relationship: rel, name: '',
        invitedBy: u.uid, invitedByName: 'Olive', status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() }),
      window.LL.db.doc('households/' + window.LL.householdId).update(new firebase.firestore.FieldPath('pendingInvites', email), { name: '', relationship: rel, role: 'caregiver', at: Date.now() }),
    ]).then(() => 'ok', (e) => e && e.code);
  }, email, rel);
  ok('she invites Nina by email', (await inviteFor('nina@cubby.test', 'Auntie')) === 'ok');
  ok('and Paul', (await inviteFor('paul@cubby.test', 'Uncle')) === 'ok');
  ok('and Dora', (await inviteFor('dora@cubby.test', 'Granny')) === 'ok');
  const link = await A.evaluate(() => window.LL.createInviteLink({ role: 'caregiver', relationship: 'Nanny' }));
  ok('and mints a link for Rosa', !!(link && link.token), link);

  /* ---- 2. a newcomer with an invite is asked, and says yes ---- */
  console.log('\n2. Nina, new, invited by email: asked first, then joins');
  const N = await person('nina@cubby.test');
  ok('she is shown the question', await waitSheet(N));
  const nt = await sheetText(N);
  ok('naming who invited her', /Olive invited you/.test(nt), nt);
  ok('with a way to start her own instead', /Start my own Cubby/.test(nt), nt);
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
  ok('Olive\'s pending row for the link is gone', !((hh2.pendingLinks || {})[link.token]), hh2.pendingLinks);
  const lk = (await read(R, 'inviteLinks/' + link.token)).data || {};
  ok('the link is used AND consumed', lk.usedBy === r.uid && lk.consumed === true, lk);

  /* ---- 6. the attacks, which only the new rules close ---- */
  if (!OLD_MODE) {
    console.log('\n6. removed, Rosa tries to come back; a caregiver tries to schedule the wipe');
    const removed = await A.evaluate((uid) => window.LL.db.doc('households/' + window.LL.householdId).update({
      ['members.' + uid]: firebase.firestore.FieldValue.delete(), ['memberInfo.' + uid]: firebase.firestore.FieldValue.delete(),
      ['formerMemberInfo.' + uid]: { name: '', relationship: 'Nanny', avatar: null } }).then(() => 'ok', (e) => e && e.code), r.uid);
    ok('Olive removes Rosa', removed === 'ok', removed);
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
  ok('no page errors on any phone', errs.length === 0, errs.slice(0, 3));

  await browser.close();
  serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('INVITE-CONSENT: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
