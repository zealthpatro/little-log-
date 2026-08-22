/* Sign-in inside an installed iOS home-screen app, proved end to end.
 *
 * THE BUG (2026-08-19, P0). Every iOS home-screen install was a sign-in trap. A home-screen PWA gets
 * its OWN storage container; the OAuth handler is cross-origin and the email link is outside manifest
 * scope, so all three methods LEAVE that container. The parent signed in perfectly — in Safari — and
 * the installed app sat there signed out. One of them wrote that she was ready to hand over her
 * passport to prove who she was.
 *
 * THE FIX being pinned here: a code, not a link. A link navigates and iOS Mail decides where it lands.
 * A code does not navigate — you read it, come back, and type it where you already are — so the session
 * is created in the container that asked for it. That is the whole property, and it is the one thing a
 * screenshot cannot show you.
 *
 * WHY IT NEEDS ITS OWN HARNESS. ?fsemu REPLACES auth with a stub carrying a fixed currentUser, which
 * bypasses sign-in completely — useful for the sync layer, useless here. So this uses the ?authemu
 * sibling: the REAL Firebase Auth SDK against the Auth emulator, where signInWithCustomToken genuinely
 * creates a session. The container is emulated the way iOS actually presents one: an iPhone user agent
 * plus navigator.standalone and a matchMedia that answers display-mode: standalone, which together are
 * what codeSignin() reads.
 *
 * WHAT IS REAL AND WHAT IS STOOD IN. Real: the whole client path — emailRowHtml, wireEmailRow, sendCode,
 * showCodeEntry, the verify call, signInWithCustomToken, and the auth state that follows. Stood in: the
 * two Worker endpoints, because worker.js needs a service account and Resend to run, and neither belongs
 * in a test. The server half is verified against production separately (403 cross-origin, 400 on a
 * malformed address before any send, 400 bad_code with no oracle).
 *
 *   cd test && node ios-signin-code.test.js
 *
 * It must fail if sign-in ever leaves the container again. That is the point of it.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FS_PORT = 8183;
const AUTH_PORT = 9399;
const WEB_PORT = 8096;          // our little front server: app + the two stood-in endpoints
const STATIC_PORT = 8095;       // tools/serve.js behind it
const EXEC_PROJECT = 'demo-cubby-iossignin';
const EMAIL = 'parent@example.test';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ('  ' + JSON.stringify(extra)) : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function get(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); })
      .on('error', () => resolve({ status: 0, body: '' }));
  });
}

/* ---------- outer phase: stand the emulators up, then re-run ourselves inside ---------- */
if (!process.env.IOS_SIGNIN_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-iossignin-'));
  fs.writeFileSync(path.join(scratch, 'open.rules'),
    "rules_version = '2';\nservice cloud.firestore { match /databases/{db}/documents { match /{document=**} { allow read, write: if true; } } }\n");
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'open.rules' },
    emulators: { firestore: { port: FS_PORT }, auth: { port: AUTH_PORT }, ui: { enabled: false } }
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const env = Object.assign({}, process.env, { IOS_SIGNIN_INNER: '1', PATH: '/opt/homebrew/opt/openjdk/bin:' + process.env.PATH });
  try {
    execFileSync(firebaseBin, [
      'emulators:exec', '--only', 'firestore,auth', '--project', EXEC_PROJECT,
      '--config', path.join(scratch, 'firebase.json'),
      `node ${JSON.stringify(__filename)}`
    ], { cwd: scratch, env, stdio: 'inherit' });
  } catch (e) { process.exitCode = e.status || 1; }
  return;
}

/* ---------- the two Worker endpoints, stood in ---------- */
/* The Auth emulator accepts an UNSIGNED custom token, so no service-account key is needed here and none
   is read. Everything the client does with the token afterwards is real. */
function customToken(uid) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
    iss: 'test@cubby.test', sub: 'test@cubby.test',
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 300, uid: uid
  }) + '.';
}

(async () => {
  let issued = null;                       // the code we "emailed", so the test can read it back
  let staticProc = null;
  if ((await get(`http://localhost:${STATIC_PORT}/app/`)).status !== 200) {
    staticProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
      { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(STATIC_PORT) }) });
    for (let i = 0; i < 40 && (await get(`http://localhost:${STATIC_PORT}/app/`)).status !== 200; i++) await sleep(250);
  }

  const front = http.createServer((req, res) => {
    const json = (o, s) => { res.writeHead(s || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/signin-code' || req.url === '/api/signin-verify') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) {}
        if (req.url === '/api/signin-code') {
          issued = { email: String(b.email || '').toLowerCase(), code: '314159' };
          return json({ ok: true });
        }
        if (!issued || String(b.email || '').toLowerCase() !== issued.email || String(b.code) !== issued.code) {
          return json({ error: 'bad_code' }, 400);
        }
        issued = null;                                       // single use, like the real one
        return json({ token: customToken('IOSPARENT') });
      });
      return;
    }
    // everything else: straight through to the static server
    const p = http.request({ hostname: 'localhost', port: STATIC_PORT, path: req.url, method: req.method, headers: req.headers },
      (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(p);
  });
  await new Promise((r) => front.listen(WEB_PORT, r));

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  /* BE the installed container. codeSignin() reads isStandaloneApp() and isIOSDevice(); the first is
     display-mode/navigator.standalone, the second the user agent. Without this the page is just mobile
     Safari, which takes the LINK path and would prove nothing about the bug. */
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true });
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
      ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null }
      : mm(q));
  });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  const URL_ = `http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}`;
  await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(3500);
  const startHref = await page.evaluate(() => location.href);

  console.log('\nthe installed container is offered a code, not a link');
  const offer = await page.evaluate(() => {
    const t = document.querySelector('.ll-email-toggle');
    return { text: t ? t.textContent.trim() : null, standalone: navigator.standalone === true };
  });
  ok('we are emulating a standalone iOS app', offer.standalone, offer);
  ok('and the email row offers a CODE, because a link cannot come back here', /code/i.test(offer.text || ''), offer);

  console.log('\nshe asks for the code and types it in, without leaving');
  await page.evaluate((email) => {
    document.querySelector('.ll-email-toggle').click();
    const f = document.querySelector('.ll-email-form');
    f.querySelector('input').value = email;
    f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, EMAIL);
  await sleep(1200);
  ok('the code endpoint was asked for one', !!issued, { issued: !!issued });

  const codeFormShown = await page.evaluate(() => {
    const cf = document.querySelector('.ll-code-form');
    return !!cf && cf.style.display !== 'none';
  });
  ok('and she is shown somewhere to type it', codeFormShown);

  /* Guarded, because a gate whose failure mode is a stack trace is a worse gate. On the pre-fix build
     there is no code form at all — the old path emails a LINK, which the Auth emulator helpfully prints
     — and an unguarded querySelector threw here, which skipped the two assertions that matter most:
     whether she ends up signed in, and whether anything navigated to get her there. Fail, keep going,
     report everything. */
  if (codeFormShown) {
    await page.evaluate((code) => {
      const cf = document.querySelector('.ll-code-form');
      cf.querySelector('input').value = code;
      cf.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }, '314159');
    await sleep(4000);
  } else {
    console.log('         (no code form to fill — the build under test is still on the link path)');
  }

  console.log('\nthe session lands in THIS container');
  const after = await page.evaluate(() => {
    let uid = null;
    try { uid = (window.LL && LL.auth && LL.auth.currentUser && LL.auth.currentUser.uid) || null; } catch (e) {}
    return { uid: uid, href: location.href, signInCardGone: !document.querySelector('.ll-email-toggle') };
  });
  ok('she is signed in, in the container she started in', after.uid === 'IOSPARENT', after);
  /* The property the whole fix exists for. If this ever fails, sign-in has started navigating again and
     the installed app is back to completing in Safari. */
  ok('and nothing navigated away to get there', after.href === startHref, { startHref, endHref: after.href });
  ok('the sign-in card gave way to the app', after.signInCardGone, after);

  ok('no uncaught page errors', errs.length === 0, errs.join(' | '));

  console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  front.close();
  if (staticProc) staticProc.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
