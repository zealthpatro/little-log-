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
 *   node test/ios-signin-code.test.js     (a gate: tools/gates.js --emulator, as ios-signin)
 *   Ports are overridable so it never lands on someone else's emulator: FS_PORT, AUTH_PORT,
 *   WEB_PORT, STATIC_PORT. It always starts its OWN static server and checks that server is serving
 *   this checkout; it used to reuse anything already on 8095, which could grade a different tree.
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
const FS_PORT = Number(process.env.FS_PORT) || 8783;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9783;
const WEB_PORT = Number(process.env.WEB_PORT) || 8786;          // our little front server: app + the two stood-in endpoints
const STATIC_PORT = Number(process.env.STATIC_PORT) || 8785;    // tools/serve.js behind it
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
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
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { IOS_SIGNIN_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
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
  if ((await get(`http://localhost:${STATIC_PORT}/app/`)).status !== 0) {
    ok('port ' + STATIC_PORT + ' is free for this run\'s own static server (set STATIC_PORT)', false);
    process.exit(1);
  }
  const staticProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
    { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(STATIC_PORT) }) });
  for (let i = 0; i < 40 && (await get(`http://localhost:${STATIC_PORT}/app/`)).status !== 200; i++) await sleep(250);
  // The served client must be THIS checkout's, byte for byte, or every verdict below is about another tree.
  const servedStore = (await get(`http://localhost:${STATIC_PORT}/app/store-firebase.js`)).body;
  ok('the static server is serving this checkout', servedStore === fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8'));

  const front = http.createServer((req, res) => {
    const json = (o, s) => { res.writeHead(s || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/signin-code' || req.url === '/api/signin-verify') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) {}
        if (req.url === '/api/signin-code') {
          issued = { email: String(b.email || '').toLowerCase(), code: '314159' };
          /* The real worker's reply says what the email holds (since 13cf826c, 2026-08-30), and the
             panel only offers a code box when it says hasCode. This stub still answered {ok:true},
             so the box never appeared and the test failed on base and head alike, unseen, because it
             was never wired into tools/gates.js. */
          return json({ ok: true, hasCode: true, hasLink: true });
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
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
    downloadBehavior: require(path.join(ROOT, 'tools', 'gate_downloads.js')).downloadBehavior() });
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
    /* The iPhone keyboard, as WebKit reports it: the visual viewport gets shorter and fires resize, and
       nothing else changes (100dvh included). Chrome has no on-screen keyboard, so window.__keys(px)
       stands one in. */
    let keys = 0;
    const vv = new EventTarget();
    Object.defineProperties(vv, {
      width: { get: () => document.documentElement.clientWidth },
      height: { get: () => document.documentElement.clientHeight - keys },
      offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 },
      pageTop: { get: () => window.scrollY }, pageLeft: { get: () => window.scrollX },
    });
    Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
    window.__keys = (px) => { keys = px; vv.dispatchEvent(new Event('resize')); };
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

  /* Device test, 16 Nov 2026 (iPhone 18 Pro, the TestFlight app): she tapped "Prefer email? Get a
     sign-in code" and typed her address with the field and Send code under the keys. The screen is one
     phone tall, so there was nothing to scroll. */
  console.log('\nthe keyboard never covers the field she is typing in');
  const KEYS = 340;   // an iPhone keyboard with its suggestions bar, in CSS pixels
  const formBox = (sel, k) => page.evaluate((s, kk) => {
    const f = document.querySelector(s), r = f.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), keysTop: document.documentElement.clientHeight - kk, focused: f.contains(document.activeElement) };
  }, sel, k);
  await page.evaluate(() => document.querySelector('.ll-email-toggle').click());
  await sleep(300);
  const kb0 = await formBox('.ll-email-form', KEYS);
  ok('the email field has focus and sits where the keys come up, so the next check can fail', kb0.focused && kb0.bottom > kb0.keysTop, kb0);
  await page.evaluate((k) => window.__keys(k), KEYS);
  await sleep(400);
  const kb1 = await formBox('.ll-email-form', KEYS);
  ok('with the keys up, the email field and Send code are above them', kb1.bottom <= kb1.keysTop && kb1.top >= 0, kb1);
  await page.evaluate(() => window.__keys(0));
  await sleep(300);
  const pad = await page.evaluate(() => document.getElementById('llAuthOv').style.paddingBottom);
  ok('and when the keys go, the room made for them goes too', pad === '', { paddingBottom: pad });

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
    await page.evaluate((k) => window.__keys(k), KEYS);
    await sleep(400);
    const kb2 = await formBox('.ll-code-form', KEYS);
    ok('the code box has focus, and with the keys up it is above them too', kb2.focused && kb2.bottom <= kb2.keysTop && kb2.top >= 0, kb2);
    await page.evaluate(() => window.__keys(0));
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
  staticProc.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
