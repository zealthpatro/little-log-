/* Tapping the sign-in link in the email signs her in to the iPhone app once, with nothing more asked.
 *
 * THE BUG (16 Nov 2026, the founder's simulator, a signed build with applinks:little-cubby.com on the
 * live app). The sign-in email carries a code AND a link. She asked for a code on the app's sign-in
 * screen and tapped the link instead: iOS opened the app, and the app reloaded itself five times in a
 * minute, each time with the bare "Confirm your email to finish signing in" box. Typing her address
 * and tapping Ok was followed within a second by another reload and another empty box. She was never
 * signed in; only killing the app ended it. Two causes, both proven here:
 *   1. app/native-bridge.js asked Capacitor's getLaunchUrl on every page load. It answers with the
 *      LAST link that opened the app for the whole life of the process, and a sign-in link is routed
 *      with location.replace, a page load, which asked again. (test/native-deeplink.test.js pins every
 *      rule of the routing itself, with mutants; this file proves the whole thing on the real pages.)
 *   2. Only the link sender saved her address for the link to finish with. The code sender never did,
 *      though its email carries the link too, so a link tapped on the same phone always met the box.
 *
 * WHAT IS REAL. The app's own pages, sign-in screen, sendCode, maybeFinishEmailLink and the real
 * Firebase Auth SDK, against the Auth emulator, with an email-link code the emulator really minted (so
 * the link really signs her in, and a second use of it really fails). Firestore is the emulator too.
 * STOOD IN. The Capacitor bridge the wrapper injects (App.getLaunchUrl answers with the process's last
 * link, appUrlOpen fires on a tap, as @capacitor/app 8.1.1 and @capacitor/ios 8.4.2 do), and the
 * Worker's /api/signin-code (it needs a service account and Resend). One tab is one app PROCESS: its
 * sessionStorage and the stand-in's lastURL both end with it; a browser context is one phone.
 * The emulator ports ride in the link the test taps (authemu, fsemu), because the app reads them
 * from its own address and the link is the next address it has; without them the routed page would
 * talk to the real Firebase. Every request that is not to this machine is refused and counted.
 *
 * A LINK THAT CANNOT WORK (17 Nov 2026, a skeptic's review). A used or expired code, or an address kept
 * on this phone that is not the link's, must never leave the sign-in screen over a signed-in app, run the
 * dead code again on a later load, or say "doesn't look right" with no box to put it right (D, X, K).
 * Identity Toolkit is a network round trip away on a phone and milliseconds away here, so those sections
 * slow the emulator's answer (slowLink) or the auth answer (slowLookup) to the order a phone sees.
 *
 *   node test/native-signin-link.test.js     (a gate: tools/gates.js --emulator, as native-signin-link)
 *   ONLY=A|B|S|L2|D|X|K runs those sections (comma-separated). Ports: FS_PORT, AUTH_PORT, WEB_PORT, STATIC_PORT (+ HUB/LOG/WS).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FS_PORT = Number(process.env.FS_PORT) || 8813;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9813;
const WEB_PORT = Number(process.env.WEB_PORT) || 8816;
const STATIC_PORT = Number(process.env.STATIC_PORT) || 8815;
const HUB_PORT = Number(process.env.HUB_PORT) || 0, LOG_PORT = Number(process.env.LOG_PORT) || 0, WS_PORT = Number(process.env.WS_PORT) || 0;
const PROJECT = 'demo-cubby-nativelink';
const API_KEY = 'AIzaSyBj10mZkKlaX4BvYprssPdnUKsIXUCVvZU';   // the app's public web key (app/firebase-init.js)
const EMAIL = 'mama@example.com', EMAIL2 = 'papa@example.com', EMAIL3 = 'gran@example.com', EMAIL4 = 'auntie@example.com';
const EMAIL5 = 'nana@example.com', EMAIL6 = 'uncle@example.com', EMAIL7 = 'cousin@example.com', EMAIL8 = 'sitter@example.com', EMAIL9 = 'neighbour@example.com';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ONLY = process.env.ONLY || '';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ('  ' + JSON.stringify(extra)) : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function req(method, url, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: b, json: j }); });
    });
    r.on('error', () => resolve({ status: 0, body: '', json: null }));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

/* ---------- outer phase: stand the emulators up, then re-run ourselves inside ---------- */
if (!process.env.NATIVE_LINK_INNER) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-nativelink-'));
  fs.writeFileSync(path.join(scratch, 'open.rules'),
    "rules_version = '2';\nservice cloud.firestore { match /databases/{db}/documents { match /{document=**} { allow read, write: if true; } } }\n");
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'open.rules' },
    emulators: Object.assign({ firestore: Object.assign({ port: FS_PORT }, WS_PORT ? { websocketPort: WS_PORT } : {}), auth: { port: AUTH_PORT }, ui: { enabled: false } },
      HUB_PORT ? { hub: { port: HUB_PORT } } : {}, LOG_PORT ? { logging: { port: LOG_PORT } } : {})
  }));
  const firebaseBin = process.env.FIREBASE_BIN || path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { NATIVE_LINK_INNER: '1', PATH: javaBin + ':' + process.env.PATH });
  try {
    execFileSync(firebaseBin, [
      'emulators:exec', '--only', 'firestore,auth', '--project', PROJECT,
      '--config', path.join(scratch, 'firebase.json'),
      `node ${JSON.stringify(__filename)}`
    ], { cwd: scratch, env, stdio: 'inherit' });
  } catch (e) { process.exitCode = e.status || 1; }
  return;
}

/* A real email-link code, minted by the Auth emulator the way Identity Toolkit mints the one in her email. */
async function mintLink(email) {
  const sent = await req('POST', `http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`,
    { requestType: 'EMAIL_SIGNIN', email, continueUrl: 'https://little-cubby.com/app/', canHandleCodeInApp: true });
  if (sent.status !== 200) throw new Error('sendOobCode ' + sent.status + ' ' + sent.body);
  const list = await req('GET', `http://127.0.0.1:${AUTH_PORT}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const mine = ((list.json && list.json.oobCodes) || []).filter((c) => c.email === email && c.requestType === 'EMAIL_SIGNIN');
  if (!mine.length) throw new Error('no oobCode listed for ' + email + ': ' + list.body.slice(0, 300));
  const code = mine[mine.length - 1].oobCode;
  /* The universal link in the email, as the Worker rewrites it onto little-cubby.com, plus the emulator ports. */
  return { code, url: 'https://little-cubby.com/__/auth/action?apiKey=' + API_KEY + '&mode=signIn&oobCode=' + encodeURIComponent(code)
    + '&continueUrl=' + encodeURIComponent('https://little-cubby.com/app/') + '&lang=en&fsemu=' + FS_PORT + '&authemu=' + AUTH_PORT };
}

(async () => {
  if ((await req('GET', `http://127.0.0.1:${STATIC_PORT}/app/`)).status !== 0) {
    ok('port ' + STATIC_PORT + ' is free for this run\'s own static server (set STATIC_PORT)', false);
    process.exit(1);
  }
  const staticProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js')],
    { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(STATIC_PORT) }) });
  for (let i = 0; i < 40 && (await req('GET', `http://127.0.0.1:${STATIC_PORT}/app/`)).status !== 200; i++) await sleep(250);
  for (const f of ['app/store-firebase.js', 'app/native-bridge.js', 'app/firebase-init.js']) {
    const served = (await req('GET', `http://127.0.0.1:${STATIC_PORT}/${f}`)).body;
    ok('the static server is serving this checkout\'s ' + f, served === fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }

  /* /api/signin-code, stood in. Answers whatever the section sets; it records what it was asked. */
  let codeAnswer = { ok: true, hasCode: true, hasLink: true };
  const asked = [];
  const front = http.createServer((rq, res) => {
    const json = (o, s) => { res.writeHead(s || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (rq.url === '/api/signin-code' || rq.url === '/api/send-signin-link' || rq.url === '/api/signin-verify') {
      let body = '';
      rq.on('data', (d) => { body += d; });
      rq.on('end', () => {
        let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) {}
        asked.push({ path: rq.url, email: String(b.email || '') });
        if (rq.url === '/api/signin-code') return json(codeAnswer);
        return json({ error: 'not_in_this_test' }, 503);
      });
      return;
    }
    const p = http.request({ hostname: '127.0.0.1', port: STATIC_PORT, path: rq.url, method: rq.method, headers: rq.headers },
      (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); });
    rq.pipe(p);
  });
  await new Promise((r) => front.listen(WEB_PORT, r));
  const BASE = `http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}`;   // the wrapper's server.url

  const puppeteer = require(path.join(ROOT, 'tools', 'node_modules', 'puppeteer-core'));
  const dl = require(path.join(ROOT, 'tools', 'gate_downloads.js'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], downloadBehavior: dl.downloadBehavior() });
  const offMachine = [];

  /* One app process: a tab with the wrapper's bridge stood in. lastUrl is the process's
     ApplicationDelegateProxy.lastURL; retained is an appUrlOpen Capacitor holds for the first listener. */
  async function openProcess(phone, lastUrl, retained) {
    const P = { lastUrl: lastUrl || null, retained: retained || null, docs: [], prompts: [], linkSignins: 0, errs: [], saw: [], notes: [], slowLink: 0, slowLookup: 0 };
    const page = await phone.newPage();
    P.page = page;
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148');
    await page.exposeFunction('__capLastUrl', () => P.lastUrl);
    await page.exposeFunction('__capTakeRetained', () => { const u = P.retained; P.retained = null; return u; });
    /* Every document this tab loads, counted from inside it: a load served by the app's service worker
       never reaches the page's own network log, so the request log cannot be the count. */
    await page.exposeFunction('__capDoc', (href) => { P.docs.push(String(href)); });
    /* Every link error the sign-in screen ever DRAWS, even for a moment: an end state can look right after
       an error flashed over her app and was taken down again. */
    await page.exposeFunction('__capSaw', (said) => { P.saw.push(String(said)); });
    /* Every toast as it is shown, and whether the sign-in cover (#llAuthOv, above every toast) hid it. */
    await page.exposeFunction('__capNote', (note) => { P.notes.push(String(note)); });
    await page.evaluateOnNewDocument(() => {
      if (window.top === window) window.__capDoc(location.href);
      /* K5: storage that reads the kept address but will not let it go. */
      try {
        if (sessionStorage.getItem('__refuseRemove')) {
          const remove = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (k) { if (k === 'cubby-email-signin') throw new Error('refused'); return remove.call(this, k); };
        }
      } catch (e) {}
      if (window.top === window) {
        let told = false, shown = '';
        new MutationObserver(() => {
          const ov = document.getElementById('llAuthOv');
          const m = !told && ov && /expired or was already used|didn.t finish|doesn.t look right/.exec(ov.textContent || '');
          if (m) { told = true; window.__capSaw(m[0]); }
          const t = document.getElementById('toast');
          const now = t && t.classList.contains('show') ? t.textContent : '';
          if (now !== shown) { shown = now; if (now) window.__capNote(now + (ov ? ' [hidden under the cover]' : '')); }
        }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
      }
      const L = window.__capL = {};
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        Plugins: {
          App: {
            addListener: (name, cb) => {
              (L[name] = L[name] || []).push(cb);
              if (name === 'appUrlOpen') window.__capTakeRetained().then((u) => { if (u) cb({ url: u }); });
              return Promise.resolve({ remove() {} });
            },
            getLaunchUrl: () => window.__capLastUrl().then((u) => (u ? { url: u } : {})),
            getInfo: () => Promise.resolve({ version: '2026.46.1' }),
          },
        },
      };
    });
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      let host = '';
      try { host = new URL(r.url()).hostname; } catch (e) {}
      if (/^https?:/.test(r.url()) && !['localhost', '127.0.0.1', '[::1]'].includes(host)) { offMachine.push(r.url().slice(0, 80)); return r.abort(); }
      const later = (ms) => { setTimeout(() => { r.continue().catch(() => {}); }, ms); };
      if (/accounts:signInWithEmailLink/.test(r.url()) && r.method() === 'POST') { P.linkSignins++; if (P.slowLink) return later(P.slowLink); }
      // Firebase asks the server about the saved account before its first auth answer (reloadAndSetCurrentUserOrClear).
      if (/accounts:lookup/.test(r.url()) && r.method() === 'POST' && P.slowLookup) return later(P.slowLookup);
      return r.continue();
    });
    page.on('dialog', async (d) => {
      P.prompts.push(d.type() + ': ' + d.message());
      // What she did on the simulator: typed her address and tapped Ok.
      try { if (d.type() === 'prompt' && P.answer) await d.accept(P.answer); else await d.dismiss(); } catch (e) {}
    });
    page.on('pageerror', (e) => P.errs.push(e.message));
    return P;
  }
  const tap = (P, url) => { P.lastUrl = url; return P.page.evaluate((u) => { (window.__capL.appUrlOpen || []).forEach((f) => f({ url: u })); }, url).catch(() => {}); };
  const who1 = (P) => P.page.evaluate(() => {
    let email = null;
    try { email = (window.LL && LL.auth && LL.auth.currentUser && LL.auth.currentUser.email) || null; } catch (e) {}
    const ov = document.getElementById('llAuthOv');
    const words = (ov && ov.innerText) || '';
    return { email, path: location.pathname + location.search, stored: localStorage.getItem('cubby-email-signin'),
      didntFinish: /didn.t finish|need the email address/i.test(words), signInShown: !!document.querySelector('.ll-email-toggle') };
  });
  /* Asked again while a load is under way (the loop on 9f66ef19 never stops loading). */
  async function who(P) {
    let last = null;
    for (let i = 0; i < 8; i++) { try { return await who1(P); } catch (e) { last = String(e).slice(0, 120); await sleep(250); } }
    return { error: last };
  }
  const few = (list) => ({ count: list.length, first: list.slice(0, 2) });
  async function askForCode(P, email) {
    // The sign-in screen comes back a moment after a sign-out; wait for it rather than for a fixed time.
    await P.page.waitForSelector('.ll-email-toggle, .ll-email-form', { timeout: 10000 }).catch(async () => {
      throw new Error('no sign-in screen to ask on: ' + JSON.stringify(await screen(P)));
    });
    await P.page.evaluate((em) => {
      const t = document.querySelector('.ll-email-toggle'); if (t) t.click();
      const f = document.querySelector('.ll-email-form');
      f.querySelector('input').value = em;
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }, email);
    await sleep(800);
  }
  async function signedInAs(P, email, ms) {
    for (let t = 0; t < ms; t += 250) { const w = await who(P); if (w.email === email) return w; await sleep(250); }
    return who(P);
  }
  /* A page load that may be cut short by another one (the loop) is not a crash of the test. */
  const go = (P) => P.page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 }).catch((e) => { P.goErr = String(e).slice(0, 100); });
  /* Each section is its own phone, so one that throws still lets the others report. */
  async function section(name, title, fn) {
    if (ONLY && ONLY.split(',').indexOf(name) === -1) return;
    console.log('\n' + name + '. ' + title);
    const phone = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    try { await fn(phone); } catch (e) { ok(name + ' ran to the end', false, String((e && e.stack) || e).slice(0, 300)); }
    finally { await phone.close().catch(() => {}); }
  }
  const withCode = (list, code) => list.filter((u) => u.indexOf('oobCode=' + encodeURIComponent(code)) !== -1 || u.indexOf('oobCode=' + code) !== -1);
  /* What she sees: who is signed in, the sign-in screen and anything it says, and the last toast. */
  const screen = (P) => P.page.evaluate(() => {
    let email = null, uid = null;
    try { const u = window.LL && LL.auth && LL.auth.currentUser; if (u) { email = u.email || null; uid = u.uid; } } catch (e) {}
    const ov = document.getElementById('llAuthOv');
    const t = document.getElementById('toast');
    return { email, uid, path: location.pathname + location.search, stored: localStorage.getItem('cubby-email-signin'),
      overlay: !!(ov && ov.isConnected && ov.offsetHeight > 0), signInShown: !!document.querySelector('.ll-email-toggle'),
      said: ((ov && ov.textContent) || '').match(/expired or was already used|didn.t finish|doesn.t look right/g) || [],
      toast: (t && t.textContent) || '' };
  }).catch((e) => ({ error: String(e).slice(0, 120) }));
  /* The app's own reloads (a join's location.reload, Try again) load the address she is on. The emulator
     ports go back on if the app took the query off, as production needs none. */
  async function reloadHere(P) {
    const href = await P.page.evaluate(() => location.href).catch(() => BASE);
    const u = new URL(href);
    if (!u.searchParams.has('authemu')) { u.searchParams.set('fsemu', String(FS_PORT)); u.searchParams.set('authemu', String(AUTH_PORT)); }
    await P.page.goto(u.toString(), { waitUntil: 'networkidle2', timeout: 30000 }).catch((e) => { P.goErr = String(e).slice(0, 100); });
  }
  /* A sign-in by code ends in a custom token from /api/signin-verify; the Auth emulator takes an unsigned one. */
  function customToken(uid) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: 'test@cubby.test', sub: 'test@cubby.test',
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', iat: now, exp: now + 300, uid }) + '.';
  }
  async function signInByCode(P, uid) {
    await P.page.evaluate((t) => window.LL.auth.signInWithCustomToken(t).then(() => true), customToken(uid)).catch((e) => { P.errs.push('custom token: ' + String(e).slice(0, 100)); });
    for (let t = 0; t < 12000; t += 250) { const s = await screen(P); if (s.uid === uid && !s.overlay) return s; await sleep(250); }
    return screen(P);
  }
  /* She signs out from her app once it is up, and a little after: startSync's 3.5 s boot failsafe outlives a
     sign-out (teardown never clears it), so signing out sooner gets the sign-in screen taken down again
     over an empty app. That is older than this test (9f66ef19 does it too) and not what it is about. */
  async function signOutFromApp(P) {
    for (let t = 0; t < 12000; t += 250) { const s = await screen(P); if (s.uid && !s.overlay) break; await sleep(250); }
    await sleep(4000);
    await P.page.evaluate(() => window.LL.signOut()).catch((e) => { P.errs.push('signOut: ' + String(e).slice(0, 100)); });
    await P.page.waitForSelector('.ll-email-toggle', { timeout: 10000 }).catch(() => {});
    return screen(P);
  }
  /* The link used up somewhere else first (another phone, a laptop), straight against the emulator. */
  const spend = async (link, email) => (await req('POST', `http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=${API_KEY}`, { email, oobCode: link.code })).status;

  /* ---- A. the founder's case: asked for a code in the app, tapped the link in the email ---- */
  await section('A', 'she asks for a code in the app, then taps the link in that email instead', async (phone) => {
    const P = await openProcess(phone, null);
    P.answer = EMAIL;
    await P.page.goto(BASE, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(2500);
    codeAnswer = { ok: true, hasCode: true, hasLink: true };   // the real Worker's answer to a code email that carries the link
    await askForCode(P, EMAIL);
    const before = await who(P);
    ok('A1 asking for a code whose email carries the link saves her address for that link', before.stored === EMAIL, before);
    const link = await mintLink(EMAIL);
    const docs0 = P.docs.length;
    await tap(P, link.url);
    const landed = await signedInAs(P, EMAIL, 12000);
    await sleep(4000);                                     // the loop reloaded every 1 to 30 seconds; give it room to show
    const loads = withCode(P.docs.slice(docs0), link.code);
    ok('A2 the tapped link is loaded into the app exactly once (it looped: 5 loads in a minute on 9f66ef19)', loads.length === 1, { loads: loads.length, docs: P.docs.slice(docs0).map((u) => u.slice(0, 90)) });
    ok('A3 she is never asked for her email', P.prompts.length === 0, few(P.prompts));
    ok('A4 she is signed in, by the link, as herself', landed.email === EMAIL, landed);
    ok('A5 the real link sign-in ran once', P.linkSignins === 1, { linkSignins: P.linkSignins });
    const now = await who(P);
    ok('A6 the spent code is gone from the address, and so is her saved address', !/oobCode/.test(now.path) && now.stored === null, now);
    ok('A7 no "didn\'t finish" and no sign-in screen over her app', !now.didntFinish && !now.signInShown, now);

    // Later page loads of the same process: a join's reload, Try again, a theme reload. getLaunchUrl
    // still answers with this link on every one of them.
    const docs1 = P.docs.length, signins1 = P.linkSignins;
    for (let i = 0; i < 2; i++) { await go(P); await sleep(3000); }
    const after = await signedInAs(P, EMAIL, 6000);
    ok('A8 two later page loads of the same app process never load the spent link again', withCode(P.docs.slice(docs1), link.code).length === 0, P.docs.slice(docs1).map((u) => u.slice(0, 90)));
    ok('A9 and never try it again, ask for her email, or show her the sign-in screen', P.linkSignins === signins1 && P.prompts.length === 0 && after.email === EMAIL && !after.didntFinish && !after.signInShown,
      { linkSignins: P.linkSignins, prompts: few(P.prompts), after });
    // Back to Mail, the same link tapped again while she is signed in by it.
    const docs2 = P.docs.length;
    await tap(P, link.url);
    await sleep(3000);
    const again = await who(P);
    ok('A10 tapping the spent link again while signed in by it loads nothing and asks nothing', withCode(P.docs.slice(docs2), link.code).length === 0 && P.prompts.length === 0 && again.email === EMAIL && !again.didntFinish,
      { docs: P.docs.slice(docs2), prompts: few(P.prompts), again });
    ok('A11 no uncaught page errors', P.errs.length === 0, P.errs.slice(0, 3));
  });

  /* ---- B. a cold launch: she asked for a code, the app was killed, the link launches it ---- */
  await section('B', 'the app was killed after she asked; the link launches it cold', async (phone) => {
    const first = await openProcess(phone, null);
    await first.page.goto(BASE, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(2500);
    codeAnswer = { ok: true, hasCode: true, hasLink: true };
    await askForCode(first, EMAIL2);
    await first.page.close();                              // the app process ends; localStorage stays on the phone
    const link = await mintLink(EMAIL2);
    // A new process whose lastURL is the link, and which ALSO holds it as an appUrlOpen for the first
    // listener: a cold launch may deliver it either way, or both.
    const P = await openProcess(phone, link.url, link.url);
    P.answer = EMAIL2;
    await go(P);
    const landed = await signedInAs(P, EMAIL2, 12000);
    await sleep(4000);
    const loads = withCode(P.docs, link.code);
    ok('B1 the link that cold-launched the app is loaded once, though it arrived both ways', loads.length === 1, { loads: loads.length, docs: P.docs.map((u) => u.slice(0, 90)) });
    ok('B2 she is never asked for her email', P.prompts.length === 0, few(P.prompts));
    ok('B3 she is signed in as herself, by one real link sign-in', landed.email === EMAIL2 && P.linkSignins === 1, { landed, linkSignins: P.linkSignins });
    const docs1 = P.docs.length;
    await go(P);
    await sleep(3000);
    const after = await who(P);
    ok('B4 a later page load of that process leaves the spent link alone', withCode(P.docs.slice(docs1), link.code).length === 0 && P.linkSignins === 1 && P.prompts.length === 0 && after.email === EMAIL2 && !after.didntFinish,
      { docs: P.docs.slice(docs1), linkSignins: P.linkSignins, after });
    ok('B5 no uncaught page errors', P.errs.length === 0, P.errs.slice(0, 3));
  });

  /* ---- S. a link asked for somewhere else (Safari, a laptop) and opened in the app ---- */
  await section('S', 'she asked in Safari, so the app has no address: asked once, kindly as before, then in', async (phone) => {
    const P = await openProcess(phone, null);
    await go(P);
    await sleep(2500);
    const link = await mintLink(EMAIL4);
    P.answer = null;                                         // first she cancels the box
    await tap(P, link.url);
    await sleep(4000);
    const cancelled = await who(P);
    ok('S1 the app asks for her address once, and when she cancels it says what it needs', P.prompts.length === 1 && cancelled.didntFinish && withCode(P.docs, link.code).length === 1,
      { prompts: few(P.prompts), loads: withCode(P.docs, link.code).length, cancelled });
    P.answer = EMAIL4;                                       // she taps the link in the email again, and types it this time
    await tap(P, link.url);
    const landed = await signedInAs(P, EMAIL4, 12000);
    await sleep(3000);
    ok('S2 tapping the link again gives her one more go, and typing her address signs her in', landed.email === EMAIL4 && P.prompts.length === 2 && P.linkSignins === 1,
      { landed, prompts: few(P.prompts), linkSignins: P.linkSignins });
    ok('S3 two loads of the link in all, one per tap', withCode(P.docs, link.code).length === 2, { loads: withCode(P.docs, link.code).length });
    const docs1 = P.docs.length;
    await go(P);
    await sleep(3000);
    const after = await who(P);
    ok('S4 a later page load leaves the spent link alone and asks nothing', withCode(P.docs.slice(docs1), link.code).length === 0 && P.prompts.length === 2 && after.email === EMAIL4 && !after.didntFinish,
      { docs: P.docs.slice(docs1), prompts: few(P.prompts), after });
  });

  /* ---- L2. which answers from the code sender keep her address for the link ---- */
  await section('L2', 'the address is kept exactly when the email she was sent has the link in it', async (phone) => {
    const P = await openProcess(phone, null);
    await P.page.goto(BASE, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(2500);
    const stored = () => P.page.evaluate(() => localStorage.getItem('cubby-email-signin'));
    const clear = () => P.page.evaluate(() => localStorage.removeItem('cubby-email-signin'));
    codeAnswer = { ok: true, hasCode: true, hasLink: false };   // the link did not mint: a code-only email
    await askForCode(P, EMAIL3);
    const noLink = await stored();
    ok('L2a a code-only email (hasLink false) does not keep her address', noLink === null, { stored: noLink, asked: asked.slice(-1) });
    codeAnswer = { ok: true, hasCode: true, hasLink: true };
    await askForCode(P, EMAIL3);
    const withLink = await stored();
    ok('L2b an email with the link (hasLink true) keeps it, the same way the link sender does', withLink === EMAIL3, { stored: withLink });
    codeAnswer = { ok: true, cached: true, hasCode: true, hasLink: true };   // Resend inside the minute: the cooldown's answer
    await askForCode(P, EMAIL3);
    const kept = await stored();
    ok('L2c a cooldown answer for the same address keeps it', kept === EMAIL3, { stored: kept });
    await clear();
    codeAnswer = { ok: true, cached: true };                 // a cooldown armed by an older Worker: every client reads it as code and link
    await askForCode(P, EMAIL3);
    const legacy = await stored();
    ok('L2d a cooldown answer with no hasLink (armed by an older Worker) keeps it too', legacy === EMAIL3, { stored: legacy });
    await clear();
    codeAnswer = { ok: true };                               // an older Worker's code email had no link in it
    await askForCode(P, EMAIL3);
    const old = await stored();
    ok('L2e an answer that does not say it has a link (an older Worker) does not keep it', old === null, { stored: old });
    ok('L2f every one of those went to the code sender, not the link sender', asked.filter((a) => a.email === EMAIL3).every((a) => a.path === '/api/signin-code'), asked);
  });
  /* ---- D. the same link again, the next day: she is still signed in, iOS has closed the app ---- */
  await section('D', 'she signed in by the link; iOS closed the app; the next day she taps that same link', async (phone) => {
    const first = await openProcess(phone, null);
    await first.page.goto(BASE, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(2500);
    codeAnswer = { ok: true, hasCode: true, hasLink: true };
    await askForCode(first, EMAIL5);
    const link = await mintLink(EMAIL5);
    await tap(first, link.url);
    const landed = await signedInAs(first, EMAIL5, 12000);
    ok('D0 she signs in by the link first', landed.email === EMAIL5 && first.linkSignins === 1, { landed, linkSignins: first.linkSignins });
    await sleep(1500);
    await first.page.close();
    /* A new process, launched by the spent link. Her address went with the first sign-in, so the box asks
       and she types it (whether a signed-in parent should be asked at all is the founder's call). The
       answer to the used code takes a round trip, as on a phone, so it lands after her app is up: that is
       when the sign-in screen used to come down over it, and stay. */
    const P = await openProcess(phone, link.url, null);
    P.answer = EMAIL5; P.slowLink = 2000;
    await go(P);
    await sleep(9000);
    const s = await screen(P);
    ok('D1 she stays on her app, signed in: the sign-in screen never comes down over it', s.email === EMAIL5 && !s.overlay && !s.signInShown && P.saw.length === 0, { s, saw: P.saw });
    const usedNote = (X) => X.notes.filter((n) => /already used/.test(n) && /still signed in/.test(n));
    ok('D2 a short note, shown on her app and not under the cover, says the link was already used and she is still signed in', usedNote(P).length === 1 && !/hidden under/.test(usedNote(P)[0]), { notes: P.notes });
    ok('D3 the used code comes off the address', !/oobCode/.test(s.path || 'oobCode'), { path: s.path });
    ok('D4 the link was loaded once and tried once', withCode(P.docs, link.code).length === 1 && P.linkSignins === 1, { loads: withCode(P.docs, link.code).length, linkSignins: P.linkSignins });
    const tried = P.linkSignins, asked = P.prompts.length;
    await reloadHere(P);
    await sleep(4000);
    const s2 = await screen(P);
    ok('D5 a later load of that process (a join\'s reload, Try again) asks nothing and tries nothing', P.linkSignins === tried && P.prompts.length === asked && s2.email === EMAIL5 && !s2.signInShown && P.saw.length === 0,
      { linkSignins: P.linkSignins, prompts: few(P.prompts), s2, saw: P.saw });
    await P.page.close();
    /* Again, on a phone slow to say who is signed in: Firebase checks the saved account with the server
       before its first auth answer, so the answer to the used code can come back first. Nobody is signed
       in YET at that moment, and the error was drawn over her app until the auth answer took it down. */
    const Q = await openProcess(phone, link.url, null);
    Q.answer = EMAIL5; Q.slowLookup = 3000;
    await go(Q);
    await sleep(9000);
    const q = await screen(Q);
    ok('D6 when the used code\'s answer beats the auth answer, no error is drawn, even for a moment', q.email === EMAIL5 && Q.saw.length === 0 && !q.signInShown,
      { q, saw: Q.saw, linkSignins: Q.linkSignins });
    ok('D7 and the note waits for her app to be shown: it is never hidden under the "Setting things up" cover', usedNote(Q).length === 1 && !/hidden under/.test(usedNote(Q)[0]), { notes: Q.notes });
    ok('D8 no uncaught page errors', P.errs.length === 0 && Q.errs.length === 0, P.errs.concat(Q.errs).slice(0, 3));
  });

  /* ---- X. a link used up elsewhere, then she signs in another way on that page, then it reloads ---- */
  await section('X', 'a used-up link while she is signed out, then a sign-in by code, then a reload', async (phone) => {
    const P = await openProcess(phone, null);
    await go(P);
    await sleep(2500);
    codeAnswer = { ok: true, hasCode: true, hasLink: true };
    await askForCode(P, EMAIL6);
    const link = await mintLink(EMAIL6);
    ok('X0 the link is used up before she taps it', (await spend(link, EMAIL6)) === 200);
    P.slowLink = 1500;
    await tap(P, link.url);
    await sleep(6000);
    const s1 = await screen(P);
    // The companion of D1: signed out, the sign-in screen DOES say what happened, and stays.
    ok('X1 signed out, the sign-in screen says the link was already used: one load, no box', !s1.uid && s1.signInShown && s1.said.some((w) => /already used/.test(w)) && P.prompts.length === 0 && withCode(P.docs, link.code).length === 1,
      { s1, prompts: few(P.prompts), loads: withCode(P.docs, link.code).length });
    ok('X2 and the used code comes off the address', !/oobCode/.test(s1.path || 'oobCode'), { path: s1.path });
    const byCode = await signInByCode(P, 'x-by-code');
    ok('X3 she signs in by her code instead, and the sign-in screen goes', byCode.uid === 'x-by-code' && !byCode.signInShown, byCode);
    const tried = P.linkSignins;
    await reloadHere(P);
    await sleep(5000);
    const s3 = await screen(P);
    ok('X4 a later reload never runs the used code again, and nothing comes down over her app', P.linkSignins === tried && s3.uid === 'x-by-code' && !s3.signInShown && s3.said.length === 0,
      { linkSignins: P.linkSignins, tried, s3 });
  });

  /* ---- K. the address kept on this phone: let go at sign-out, and never used against a link it does not fit ---- */
  await section('K', 'the kept address goes at sign-out, and a link for another address asks once', async (phone) => {
    const P = await openProcess(phone, null);
    await go(P);
    await sleep(2500);
    codeAnswer = { ok: true, hasCode: true, hasLink: true };
    await askForCode(P, EMAIL7);
    const byCode = await signInByCode(P, 'k-by-code');
    const keptIn = byCode.stored;
    const out = await signOutFromApp(P);
    ok('K1 the address stays while she is signed in by code, and goes when she signs out (a shared phone)', byCode.uid === 'k-by-code' && keptIn === EMAIL7 && out.stored === null && !out.uid,
      { keptIn, after: out.stored, uid: out.uid });
    // She asks for a code here for one address; the link she opens was asked for another, in Safari.
    await askForCode(P, EMAIL7);
    const link = await mintLink(EMAIL8);
    P.answer = null;                                         // first she cancels the box
    await tap(P, link.url);
    await sleep(4000);
    const cancelled = await screen(P);
    ok('K2 the kept address is not this link\'s: it is let go and she is asked once, never told "doesn\'t look right" with no box to fix it',
      P.prompts.length === 1 && cancelled.stored === null && !cancelled.uid && P.saw.length === 0 && P.linkSignins === 1,
      { prompts: few(P.prompts), stored: cancelled.stored, saw: P.saw, linkSignins: P.linkSignins });
    P.answer = EMAIL8;                                       // she taps it again and types the link's address
    await tap(P, link.url);
    const landed = await signedInAs(P, EMAIL8, 12000);
    await sleep(2000);
    ok('K3 the next tap asks again, without trying the let-go address first, and the address she types signs her in',
      landed.email === EMAIL8 && P.prompts.length === 2 && P.linkSignins === 2 && P.saw.length === 0,
      { landed, prompts: few(P.prompts), linkSignins: P.linkSignins, saw: P.saw });
    /* The same, on a phone whose storage reads but will not let the address go: asked once, and the kept
       address is never tried again and again in its place. */
    await signOutFromApp(P);
    await askForCode(P, EMAIL7);
    await P.page.evaluate(() => sessionStorage.setItem('__refuseRemove', '1'));
    const link2 = await mintLink(EMAIL9);
    const tried = P.linkSignins, asked = P.prompts.length;
    P.answer = EMAIL9;
    await tap(P, link2.url);
    const landed2 = await signedInAs(P, EMAIL9, 12000);
    await sleep(2000);
    ok('K4 with the address stuck in storage, she is still asked once and signed in, and the kept address is tried once',
      landed2.email === EMAIL9 && P.prompts.length === asked + 1 && P.linkSignins === tried + 2,
      { landed2, prompts: few(P.prompts), linkSignins: P.linkSignins - tried });
    ok('K5 no uncaught page errors', P.errs.length === 0, P.errs.slice(0, 3));
  });

  /* The SDK's own iframe loader (apis.google.com) is refused like everything else off this machine; what
     must never even be ASKED for is the real Firebase or Cubby, which would mean an emulator was not in use. */
  const prod = offMachine.filter((u) => /googleapis\.com|firebaseapp\.com|little-cubby\.com/.test(u));
  ok('the real Firebase and little-cubby.com were never asked for anything (' + offMachine.length + ' other off-machine requests refused)', prod.length === 0, prod.slice(0, 5));

  console.log('\n' + (fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  front.close();
  staticProc.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
