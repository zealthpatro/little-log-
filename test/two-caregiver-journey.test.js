/* Two real people, one household, driven through the actual UI code. The wedge, end to end.
 *
 *   node test/two-caregiver-journey.test.js
 *
 * WHY THIS EXISTS. Every Δ≥4 painkiller in the product needs a second person already logging, and
 * as of September 2026 that had never been exercised end to end anywhere: not in code, where the
 * gates seed one browser as one user, and not in production, where two people have logged on the
 * same day in 0 of 12 households. The rules layer IS covered (rules-test.js, 172 assertions across
 * three authenticated contexts). What was never run is the journey the whole product is built on:
 * one parent invites, the other joins, both log, each sees the other's name, and the recap fires.
 *
 * HOW. The Firestore emulator, two isolated browser contexts, and the localhost-only ?fsemu hook
 * with a different ?fsuid in each, so the REAL sync layer (resolveHousehold, createInviteLink,
 * claimInviteLink, persist, the household onSnapshot) runs for two distinct uids against one
 * database. Sign-in is stubbed by fsemu on purpose: this test is about what happens AFTER two
 * people are signed in. Sign-in itself is proven by the production canary every fifteen minutes.
 *
 * WHAT IT DOES NOT PROVE, said plainly. The emulator runs with open rules, exactly as the other
 * fsemu tests do, because the fsemu auth stub sends no real token. So a pass here means the CLIENT
 * does the right thing for two people. Whether the RULES let the second person do it is
 * rules-test.js's job. Together they cover it; neither alone does.
 *
 * THE NEGATIVE CONTROL. A third user with no token boots against the same emulator and must NOT
 * land in the household. Without that, "B is in A's household" could be true because everybody on
 * an open emulator ends up in the same place, and the join would be proving nothing.
 */
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const EMU_PORT = 8281;           // not 8080/8181, which other sessions' suites bind
const WEB_PORT = 8380;
const EXEC_PROJECT = 'demo-cubby-app';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + JSON.stringify(detail).slice(0, 400) : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res) => {
  http.get(url, (r) => { r.resume(); res({ status: r.statusCode }); }).on('error', () => res({ status: 0 }));
});

/* ---------- outer phase: stand the emulator up, then re-run ourselves inside it ---------- */
if (!process.env.TWO_CARE_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-twocare-'));
  fs.writeFileSync(path.join(scratch, 'open.rules'),
    "rules_version = '2';\nservice cloud.firestore { match /databases/{db}/documents { match /{document=**} { allow read, write: if true; } } }\n");
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'open.rules' },
    emulators: { firestore: { port: EMU_PORT }, ui: { enabled: false } }
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const env = Object.assign({}, process.env, { TWO_CARE_INNER: '1', PATH: '/opt/homebrew/opt/openjdk/bin:' + process.env.PATH });
  try {
    execFileSync(firebaseBin, [
      'emulators:exec', '--only', 'firestore', '--project', EXEC_PROJECT,
      '--config', path.join(scratch, 'firebase.json'),
      `node ${JSON.stringify(__filename)}`
    ], { cwd: scratch, env, stdio: 'inherit' });
  } catch (e) { process.exitCode = e.status || 1; }
  return;
}

/* ---------- inner phase: the journey ---------- */
(async () => {
  console.log('\ntwo caregivers, one household: the wedge, end to end\n');

  let serveProc = null;
  if ((await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200) {
    serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
      { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(WEB_PORT) }) });
    for (let i = 0; i < 40 && (await get(`http://localhost:${WEB_PORT}/app/`)).status !== 200; i++) await sleep(250);
  }
  /* Serve what THIS checkout holds, or the whole run grades somebody else's tree. */
  ok('the static server is serving this checkout', (await get(`http://localhost:${WEB_PORT}/app/`)).status === 200);

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

  /* One isolated context per person. Shared storage between them is the exact mistake that
     manufactured a fake sign-in P0 this week (two sessions, one browser profile). */
  const person = async (uid, extraQuery) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { (page._errs = page._errs || []).push(e.message); });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(`http://localhost:${WEB_PORT}/app/?fsemu=${EMU_PORT}&fsuid=${uid}${extraQuery || ''}`,
      { waitUntil: 'networkidle2', timeout: 45000 });
    return page;
  };
  const booted = async (page, ms) => {
    try {
      await page.waitForFunction(
        () => !!(window.LL && window.LL.householdId && typeof state !== 'undefined' && !document.getElementById('llAuthOv')),
        { timeout: ms || 30000 });
      return true;
    } catch (e) { return false; }
  };
  const who = (page) => page.evaluate(() => ({
    uid: window.LL && window.LL.auth && window.LL.auth.currentUser && window.LL.auth.currentUser.uid,
    hid: window.LL && window.LL.householdId,
    role: window.LL && window.LL.role,
    babies: (typeof state !== 'undefined' && state.babies || []).length,
    events: (typeof state !== 'undefined' && state.events || []).map((e) => ({ type: e.type, authorId: e.authorId || null })),
    members: Object.keys((window.LL && window.LL.members) || {}),
  }));
  /* Poll a page for a condition, reporting how it was satisfied: live via the listener, or only
     after a reload. That distinction is a finding in itself, so it is recorded rather than hidden. */
  const eventually = async (page, fnSrc, label, ms) => {
    const deadline = Date.now() + (ms || 15000);
    while (Date.now() < deadline) {
      if (await page.evaluate(fnSrc)) return 'live';
      await sleep(300);
    }
    await page.reload({ waitUntil: 'networkidle2', timeout: 45000 });
    if (!(await booted(page))) return 'never';
    return (await page.evaluate(fnSrc)) ? 'after-reload' : 'never';
  };

  /* ---- 1. A, the owner, arrives and has a baby ---- */
  console.log('1. the owner');
  const A = await person('alice');
  ok('A boots into a household of her own', await booted(A));
  let a = await who(A);
  ok('A is the owner', a.role === 'owner', a);
  ok('A is really alice, not the fsemu default', a.uid === 'alice', a.uid);

  /* Seed the baby the way the founder's own fsemu harness does: mutate state, persist(). The
     onboarding wizard keys on state.babies.length === 0 (app/index.html:2718). */
  await A.evaluate(() => {
    const id = 'bo1';
    state.babies = [{ id, name: 'Bo', birth: Date.now() - 70 * 86400000, sex: 'F', routines: [], doctors: [], allergies: [] }];
    state.activeBabyId = id;
    persist();
  });
  await sleep(900);
  a = await who(A);
  ok('A has one baby, so she is past onboarding', a.babies === 1, a);

  /* ---- 2. A logs something, then invites ---- */
  console.log('\n2. the first log and the invite');
  const before = (await who(A)).events.length;
  await A.evaluate(() => { addEvent({ type: 'feed', time: Date.now() - 30 * 60000, side: 'left', dur: 12 * 60000 }); });
  await sleep(900);
  a = await who(A);
  ok('A logged exactly one feed', a.events.length === before + 1 && a.events.some((e) => e.type === 'feed'), a.events);

  const link = await A.evaluate(async () => {
    try { return await window.LL.createInviteLink({ role: 'caregiver', relationship: 'Nanny', name: 'Rosa' }); }
    catch (e) { return { error: String(e && e.message || e) }; }
  });
  ok('A can mint an invite link', !!(link && link.token && link.url), link);
  ok('and it is a ?join= link to this origin', !!(link && /\/app\/\?join=/.test(link.url || '')), link && link.url);

  /* ---- 3. B arrives through the link ---- */
  console.log('\n3. the second caregiver joins');
  const B = await person('bob', '&join=' + encodeURIComponent(link.token || 'none'));
  ok('B boots', await booted(B, 45000));
  let b = await who(B);
  ok('B is really bob, a different person from A', b.uid === 'bob' && b.uid !== a.uid, { a: a.uid, b: b.uid });
  ok('B landed in A\'s household, not one of his own', !!b.hid && b.hid === a.hid, { a: a.hid, b: b.hid });
  ok('B is a caregiver, not an owner', b.role === 'caregiver', b.role);

  const sawBaby = await eventually(B, '(state.babies||[]).length >= 1', 'baby');
  ok('B sees A\'s baby (' + sawBaby + ')', sawBaby !== 'never');
  const sawFeed = await eventually(B, '(state.events||[]).some(function(e){return e.type==="feed" && e.authorId==="alice"})', 'feed');
  ok('B sees A\'s feed, attributed to alice (' + sawFeed + ')', sawFeed !== 'never');

  /* ---- 4. B logs, A sees it with B's name on it ---- */
  console.log('\n4. two people logging on the same day, which has happened in 0 of 12 real households');
  await B.evaluate(() => { addEvent({ type: 'diaper', time: Date.now() - 5 * 60000, kind: 'wet' }); });
  await sleep(900);
  const sawNappy = await eventually(A, '(state.events||[]).some(function(e){return e.type==="diaper" && e.authorId==="bob"})', 'nappy');
  ok('A sees B\'s nappy, attributed to bob (' + sawNappy + ')', sawNappy !== 'never');

  const names = await A.evaluate(() => ({ a: loggerName('alice'), b: loggerName('bob') }));
  ok('B has a name on A\'s phone', !!names.b, names);
  ok('and it is not A\'s name, so "who did what" has two names', !!names.b && names.b !== names.a, names);
  const rendered = await A.evaluate((n) => document.body.innerText.indexOf(n) >= 0, names.b || ' ');
  ok('and that name is actually painted on A\'s screen, not just in memory', rendered, names.b);

  /* ---- 5. the away recap, which returns '' unless somebody ELSE logged ---- */
  console.log('\n5. the recap that rewards coming back');
  /* Modelling "she closed the app three hours ago and just reopened it", precisely. The anchor is
     captured ONCE at script load (initAwayAnchor -> _awaySince = lastOpenAt()), and the app stamps
     last-open on visibilitychange whenever the document goes hidden, which a reload's teardown
     triggers. So a stamp written into the OLD document is overwritten with "now" on the way out,
     the window collapses to zero width, and awayRecap() returns '' correctly. Two versions of this
     test got that wrong and blamed the card. The stamp has to land in the NEW document, after the
     old one's teardown and before any app script, which is exactly what evaluateOnNewDocument does
     and the same pattern every clock-pinning gate in tools/ already uses. */
  await A.evaluateOnNewDocument(() => {
    try { localStorage.setItem('cubby-last-open:alice', String(Date.now() - 3 * 3600000)); } catch (e) {}
  });
  await A.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  ok('A boots again', await booted(A));
  await A.evaluate(() => { try { go('home'); } catch (e) {} });
  await sleep(800);
  const recap = await A.evaluate(() => {
    const t = document.body.innerText;
    let diag = {};
    try {
      diag = { anchor: _awaySince, key: lastOpenKey(), stored: localStorage.getItem(lastOpenKey()), quick: quickUid(),
        activeBaby: state.activeBabyId, babyEvs: babyEvents().length, evs: state.events.length,
        others: babyEvents().filter(e => e.authorId && e.authorId !== 'alice').length,
        recapLen: awayRecap().length, gs: !!document.querySelector('.gs-card,[class*=getstart]'),
        head: t.slice(0, 240) };
    } catch (e) { diag = { err: String(e) }; }
    return Object.assign({ shown: /while you were away/i.test(t), namesB: t.indexOf(loggerName('bob') || ' ') >= 0 }, diag);
  });
  ok('A is told what happened while she was away', recap.shown, recap);
  ok('and the recap names B', recap.namesB, recap);

  /* ---- 6. the negative control ---- */
  console.log('\n6. the control that makes all of the above mean something');
  const C = await person('carol');
  ok('C boots', await booted(C, 45000));
  const c = await who(C);
  ok('C, with no token, does NOT land in A\'s household', !!c.hid && c.hid !== a.hid, { a: a.hid, c: c.hid });
  ok('and A\'s household roster does not contain C', !(await who(A)).members.includes('carol'), (await who(A)).members);
  ok('but does contain B', (await who(A)).members.includes('bob'), (await who(A)).members);

  const errs = [].concat(A._errs || [], B._errs || [], C._errs || []);
  ok('no page errors on any of the three phones', errs.length === 0, errs.slice(0, 3));

  await browser.close();
  if (serveProc) serveProc.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('TWO-CAREGIVER-JOURNEY: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
