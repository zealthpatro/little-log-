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
 *
 * WHETHER THE EMAIL WENT (P0, 16 Nov 2026). A new Gmail address was told "we just emailed you" three times
 * and no email ever came, because Resend accepts an email for a suppressed address and then never sends it.
 * The Worker now hands back a sendRef with each send, and the panel asks /api/signin-status about it a few
 * times while she waits (at about 8, 20, 45 and 90 seconds). The last section runs its parents side by
 * side, each in her own browser context, against stood-in answers: undeliverable (the plain note, the
 * other doors, and her code still signs her in), delivered (the Spam or Promotions note, then no more
 * asking), unknown on every ask (nothing new on screen until 45 seconds, four asks: the companion that
 * proves the matcher above is not passing for free), an older Worker that sends no sendRef (no asks at
 * all, the panel as before until 45 seconds), and an undeliverable email that carried no code (the note promises
 * none). Round 6's skeptic added five parents (M-S1, M-S2, M-S8): "Wrong email?" and the same address
 * again inside the minute, answered from the cooldown, keeps the note (wrong); a reload inside the minute
 * shows the state the Worker's cooldown answer carries (reload); a wrong code typed before or after the
 * answer never wipes the note (badcode); and asking stops when she signs in (stopper) or the panel
 * leaves the screen (leaver) before anything settles. And two checks on the undeliverable parent
 * (M-S4): the status line is a live region already on the page, empty, before its words arrive.
 * Throughout, what she has typed is kept.
 *
 * ROUND 7 (eight more parents, eighteen in all). The founder's reading of Resend: the send was Suppressed,
 * and production's key may only be allowed to send, so every status ask can be 'unknown'. Above the keys
 * (R6M2-1): with the stood-in keyboard up over the code box, an undeliverable answer over an EMPTY box lets
 * go of it so the keys go down and the note, Google and Apple are on screen (kempty375, kempty320); a box
 * she typed into keeps its focus and the note comes up above the keys with it, as do delivered and the slow
 * line, at 375 and at 320 px (ktyped, karrived, kslow), and so does a wrong code's error. No answer yet
 * (M7-3): nothing settled by the 45-second ask brings one line, once, "It can take a few minutes to arrive.
 * You can also continue with Google or Apple now." (quiet, whose 45-second answer is held 400 ms so "after
 * the ask came back" is measurable), with no sendRef at all (old), and after a reload whose cooldown answer
 * knows nothing (reload2, 15 seconds after that answer); a bounce at the last ask replaces it (late).
 * "Resend email" goes under an undeliverable note and "Wrong email?" stays (M7-4). A different address after
 * "Wrong email?" never inherits the first one's note (wrongother, M7-5). At 320 and 375 px the email row,
 * the code row and the note keep the same gutter on both sides (M7-7).
 * ROUND 7, PASS 2 (six more parents, twenty-four in all). The slow line is timed from the send, not from a
 * step of the asking chain. She goes to Mail right after asking (the page frozen, as iOS suspends an app
 * off screen) and comes back 60 seconds on: the line is there within moments of her return, with a sendRef
 * (away) and without (awayold, the companion); back at 30 seconds, it still comes about 45 seconds after
 * the send (awayearly); a phone that slept, its timers behind the wall clock, gets it with the first answer
 * that is not settled (slept). A status route that never answers is given up, and the line still comes
 * (hang); codes paused with her newest still working (liveCode) never gets it, as no new email went
 * (livecode, with old as its companion).
 *   IOS_SIGNIN_SHOTS=<folder>       save a PNG at each of those moments (the keys drawn in grey), to read
 *   IOS_SIGNIN_ONLY=<parent,...>    run only those parents while working on one; exits 3, never a verdict
 *
 * TIME. The 90-second schedule used to be waited out in real time, which made this gate about 125 s on
 * every emulator-tier push (about 57 s now, on a machine with a load average near 7). Scenes that only
 * need the schedule's shape run, from just before the send, on a page whose setTimeout divides every
 * wait of 8 s or more by FAST and records the wait it was asked for (window.__waits; put in after boot,
 * so the app's own boot timers keep real time), so the quiet parent proves both the waits the panel
 * asked for (8, 12, 25, 45 s) and when the asks really went (at 8, 20, 45 and 90 s on that clock). The
 * undeliverable parent keeps the real clock, so the first ask is still proved to come about 8 real
 * seconds after the send.
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
/* Every step waits for what its assertion needs, never for a length of time (test/helpers/wait-for.js says
   why). The card is drawn by the first onAuthStateChanged, and on an iPhone user agent Firebase Auth 10.12.2
   holds that until its load of https://apis.google.com/js/api.js has ended (a script tag, no timeout of its
   own); networkidle2 does not wait for it. So Chrome is launched below with every host but localhost
   unresolvable, as the other suites that boot the app are: that script fails at once, the SDK goes on to
   report "nobody", and the boot under test is this machine's alone. Until 20 Nov 2026 this test fetched the
   script from Google: an answer seconds late read the card as null (17 Nov), and no answer at all held the
   card past a 90 s BOOT. BOOT is now 30 s, so a card drawn late fails here, naming it. NET is for a loaded
   emulator or endpoint, UI for the app's 60 ms keyboard timer. */
const { waitFor } = require('./helpers/wait-for');
const BOOT = 30000, NET = 30000, UI = 10000;
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

/* The mail-status scenarios (the last section): what the stood-in sender answers for each address, and what
   the stood-in /api/signin-status says about each sendRef. */
const REFS = { gone: 'GoneGoneGoneGoneGone01', arrived: 'ArrivedArrivedArrive02', quiet: 'QuietQuietQuietQuiet03', linkOnly: 'LinkOnlyLinkOnlyLink04',
  wrong: 'WrongWrongWrongWrong05', reload: 'ReloadReloadReloadRe06', badcode: 'BadcodeBadcodeBadcod07', stopper: 'StopperStopperStoppe08', leaver: 'LeaverLeaverLeaverLe09',
  kEmpty: 'KeysEmptyKeysEmptyK10', kEmpty320: 'KeysEmpty320KeysEmp11', kTyped: 'KeysTypedKeysTypedK12', kArrived: 'KeysArrivedKeysArri13', kSlow: 'KeysSlowKeysSlowKeys14',
  reload2: 'ReloadTwoReloadTwoRe15', wrongX: 'WrongXWrongXWrongXW16', late: 'LateBounceLateBounce17',
  away: 'AwayAwayAwayAwayAway18', awayEarly: 'AwayEarlyAwayEarlyAw19', hang: 'HangHangHangHangHang20', slept: 'SleptSleptSleptSlept21' };
const FAST = 4;   // the clock factor for the scenes that only need the schedule's shape (see TIME above)
const SCENES = {
  /* Her second ask lands inside the Worker's one-minute cooldown, so it is answered `cached` and mails nothing. */
  'gone@example.test': { ref: REFS.gone, state: 'undeliverable', uid: 'IOSGONE', cachedAfterFirst: true },
  'arrived@example.test': { ref: REFS.arrived, state: 'delivered', uid: 'IOSARRIVED' },
  /* Its third ask (45 s) is answered 400 ms late, so "after that ask came back" is a gap a check can see. */
  'quiet@example.test': { ref: REFS.quiet, state: 'unknown', uid: 'IOSQUIET', holdAsk: { n: 3, ms: 400 } },
  'old@example.test': { ref: '', state: '', uid: 'IOSOLD' },
  /* The link sender's email when no code could be stored: no code in it, so the note must not promise one. */
  'linkonly@example.test': { ref: REFS.linkOnly, state: 'undeliverable', uid: 'IOSLINK', noCode: true },
  /* M-S1. Her second and third asks are answered from the cooldown by a Worker that does not (yet) know
     what became of the email: first cached, then the answer for a code email whose link failed. The fourth
     finds the code sender down, so the panel falls back to Firebase's own sender: a different email by a
     different road, which the old verdict says nothing about. */
  'wrong@example.test': { ref: REFS.wrong, state: 'undeliverable', uid: 'IOSWRONG',
    later: [{ ok: true, cached: true, hasCode: true, hasLink: true }, { ok: true, hasCode: true, hasLink: false }, { __status: 503, error: 'send_failed' }] },
  /* M-S1, a reload: a fresh page has no memory, so the Worker's cooldown answer says what it found. */
  'reload@example.test': { ref: REFS.reload, state: 'undeliverable', uid: 'IOSRELOAD',
    later: [{ ok: true, cached: true, hasCode: true, hasLink: true, state: 'undeliverable' }] },
  'badcode@example.test': { ref: REFS.badcode, state: 'undeliverable', uid: 'IOSBAD' },
  'stopper@example.test': { ref: REFS.stopper, state: 'unknown', uid: 'IOSSTOP' },
  'leaver@example.test': { ref: REFS.leaver, state: 'unknown', uid: 'IOSLEAVE' },
  /* Round 7 (R6M2-1, M7-1): the answer arrives while she waits in the code box with the keys up. */
  'kempty@example.test': { ref: REFS.kEmpty, state: 'undeliverable', uid: 'IOSKEMPTY' },
  'kempty320@example.test': { ref: REFS.kEmpty320, state: 'undeliverable', uid: 'IOSKEMPTY320' },
  'ktyped@example.test': { ref: REFS.kTyped, state: 'undeliverable', uid: 'IOSKTYPED' },
  'karrived@example.test': { ref: REFS.kArrived, state: 'delivered', uid: 'IOSKARRIVED' },
  'kslow@example.test': { ref: REFS.kSlow, state: 'unknown', uid: 'IOSKSLOW' },
  /* Round 7 (R6M2-2, M7-3): a reload before the first ask, and the cooldown answer for her second send
     knows nothing settled (a sending-only key, or Resend has not decided): no state, no sendRef. */
  'reload2@example.test': { ref: REFS.reload2, state: 'unknown', uid: 'IOSRELOAD2',
    later: [{ ok: true, cached: true, hasCode: true, hasLink: true }] },
  /* Round 7 (R6M2-3, M7-5): undeliverable for this address, then "Wrong email?" and a different one,
     which the cooldown answers (other@ asked inside the last minute, from another tab). */
  'wrongx@example.test': { ref: REFS.wrongX, state: 'undeliverable', uid: 'IOSWRONGX' },
  'other@example.test': { ref: '', state: '', uid: 'IOSOTHER', alwaysCached: true },
  /* Round 7 (M7-3): nothing settled by 45 seconds, then Resend reports a bounce at the last ask (90 s). */
  'late@example.test': { ref: REFS.late, states: ['unknown', 'unknown', 'unknown', 'undeliverable'], uid: 'IOSLATE' },
  /* Round 7, pass 2 (R7M-1): she goes to Mail the moment the email is asked for, and comes back. Every
     ask is unknown (a sending-only key); the last has no sendRef (an older Worker): the companion. */
  'away@example.test': { ref: REFS.away, state: 'unknown', uid: 'IOSAWAY' },
  'awayearly@example.test': { ref: REFS.awayEarly, state: 'unknown', uid: 'IOSAWAYEARLY' },
  'awayold@example.test': { ref: '', state: '', uid: 'IOSAWAYOLD' },
  /* And a phone that slept (locked, its screen off): its timers come back behind the wall clock. */
  'slept@example.test': { ref: REFS.slept, state: 'unknown', uid: 'IOSSLEPT' },
  /* Round 7, pass 2 (R7M-2): the status route never answers; and new codes are paused while her newest
     code still works (the sender's 429 with liveCode), so no new email went at all. */
  'hang@example.test': { ref: REFS.hang, hang: true, uid: 'IOSHANG' },
  'live@example.test': { ref: '', state: '', uid: 'IOSLIVE', first: { __status: 429, error: 'rate_limited', liveCode: true, liveFor: 420, retryAfter: 1800 } },
};
const sendCount = new Map();               // how many code requests each scenario's address has made
const statusAsks = [];                     // every POST /api/signin-status: { ref, at }
let staticKid = null;                      // this run's tools/serve.js, stopped on every way out
const sentAt = {};                         // when the stood-in sender answered each scenario's address

(async () => {
  let issued = null;                       // the code we "emailed", so the test can read it back
  const issuedFor = new Map();             // the scenarios' codes, one per address
  if ((await get(`http://localhost:${STATIC_PORT}/app/`)).status !== 0) {
    ok('port ' + STATIC_PORT + ' is free for this run\'s own static server (set STATIC_PORT)', false);
    process.exit(1);
  }
  /* Gone however this run ends: tethered to the stdin pipe only this process holds (test/helpers/tree-base.js
     does the same), so even a signal that skips 'exit' ends it, and stopped on 'exit' too. Only the passing
     path used to stop it, so the throw in the pre-push run of 17 Nov 2026 left one serving on :7944 for days. */
  const staticProc = spawn(process.execPath, ['-e', 'process.stdin.on("end", () => process.exit(0)); process.stdin.on("error", () => process.exit(0)); process.stdin.resume(); require(process.argv[1]);',
    path.join(ROOT, 'tools', 'serve.js')], { stdio: ['pipe', 'ignore', 'ignore'], env: Object.assign({}, process.env, { PORT: String(STATIC_PORT) }) });
  process.on('exit', () => { try { staticProc.kill(); } catch (e) { /* gone */ } });
  staticKid = staticProc;   // the lane's catch stops it too
  for (let i = 0; i < 40 && (await get(`http://localhost:${STATIC_PORT}/app/`)).status !== 200; i++) await sleep(250);
  // The served client must be THIS checkout's, byte for byte, or every verdict below is about another tree.
  const servedStore = (await get(`http://localhost:${STATIC_PORT}/app/store-firebase.js`)).body;
  ok('the static server is serving this checkout', servedStore === fs.readFileSync(path.join(ROOT, 'app', 'store-firebase.js'), 'utf8'));

  const front = http.createServer((req, res) => {
    const json = (o, s) => { res.writeHead(s || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/signin-code' || req.url === '/api/signin-verify' || req.url === '/api/signin-status') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) {}
        const who = String(b.email || '').toLowerCase();
        if (req.url === '/api/signin-status') {
          statusAsks.push({ ref: String(b.ref), at: Date.now() });
          const sc = Object.values(SCENES).find((x) => x.ref && x.ref === b.ref);
          const nth = statusAsks.filter((a) => a.ref === String(b.ref)).length;   // this ask included
          if (sc && sc.hang) return;   // never answered: the panel must give the ask up itself
          const answer = { state: !sc ? 'unknown' : sc.states ? sc.states[Math.min(nth, sc.states.length) - 1] : sc.state };
          if (sc && sc.holdAsk && sc.holdAsk.n === nth) { setTimeout(() => json(answer), sc.holdAsk.ms); return; }
          return json(answer);
        }
        if (SCENES[who]) {
          if (req.url === '/api/signin-code') {
            const n = (sendCount.get(who) || 0) + 1; sendCount.set(who, n);
            if (n === 1 && SCENES[who].first) {
              const a = Object.assign({}, SCENES[who].first);
              const code = a.__status || 200; delete a.__status;
              return json(a, code);
            }
            if (n > 1 && SCENES[who].later) {
              const a = Object.assign({}, SCENES[who].later[Math.min(n - 2, SCENES[who].later.length - 1)]);
              const code = a.__status || 200; delete a.__status;
              return json(a, code);
            }
            if ((SCENES[who].cachedAfterFirst && sentAt[who]) || SCENES[who].alwaysCached) return json({ ok: true, cached: true, hasCode: true, hasLink: true });
            issuedFor.set(who, '314159');
            sentAt[who] = Date.now();
            return json(Object.assign({ ok: true, hasCode: !SCENES[who].noCode, hasLink: true }, SCENES[who].ref ? { sendRef: SCENES[who].ref } : {}));
          }
          if (issuedFor.get(who) !== String(b.code)) return json({ error: 'bad_code' }, 400);
          issuedFor.delete(who);
          return json({ token: customToken(SCENES[who].uid) });
        }
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
  /* Nothing off this machine: every other host is unresolvable, so the SDK's api.js fails at once instead of
     waiting on Google (BOOT says why that matters). */
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1'],
    downloadBehavior: require(path.join(ROOT, 'tools', 'gate_downloads.js')).downloadBehavior() });
  const page = await browser.newPage();
  await asInstalledIPhone(page);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  async function asInstalledIPhone(page) {
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
    /* And as on an iPhone, the keys go down when focus leaves the field and lands on nothing you can
       type in (round 7: the panel may let go of an empty code box to show her a note). */
    document.addEventListener('focusout', () => setTimeout(() => {
      const a = document.activeElement;
      if (keys && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) window.__keys(0);
    }, 0));
  });
  }

  const URL_ = `http://localhost:${WEB_PORT}/app/?fsemu=${FS_PORT}&authemu=${AUTH_PORT}`;
  await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 45000 });
  /* The sign-in card exists only once onAuthStateChanged has said "nobody" (showSignIn draws it and wires
     it in one go). On this user agent the SDK first tries to load gapi (here it fails at once, see BOOT),
     and networkidle2 does not wait for that. How long it took is printed, so a run creeping towards BOOT
     shows up before it fails. */
  const card = await waitFor(() => page.evaluate(() => !!document.querySelector('.ll-email-toggle')), { timeout: BOOT });
  const startHref = await page.evaluate(() => location.href);

  console.log('\nthe installed container is offered a code, not a link');
  console.log('         (sign-in card ' + (card.ok ? 'drawn ' + card.ms + ' ms' : 'not drawn ' + card.ms + ' ms') + ' after page.goto resolved; BOOT ' + BOOT / 1000 + ' s)');
  const offer = await page.evaluate(() => {
    const t = document.querySelector('.ll-email-toggle'), ov = document.getElementById('llAuthOv');
    return { text: t ? t.textContent.trim() : null, standalone: navigator.standalone === true, screen: t ? undefined : (ov ? ov.textContent.trim().slice(0, 80) : '(no #llAuthOv)') };
  });
  ok('we are emulating a standalone iOS app', offer.standalone, offer);
  ok('and the email row offers a CODE, because a link cannot come back here', /code/i.test(offer.text || ''),
    card.ok ? offer : Object.assign({ never: 'the sign-in card (.ll-email-toggle) within ' + BOOT / 1000 + ' s of page.goto' }, offer));

  /* Device test, 16 Nov 2026 (iPhone 18 Pro, the TestFlight app): she tapped "Prefer email? Get a
     sign-in code" and typed her address with the field and Send code under the keys. The screen is one
     phone tall, so there was nothing to scroll. */
  console.log('\nthe keyboard never covers the field she is typing in');
  const KEYS = 340;   // an iPhone keyboard with its suggestions bar, in CSS pixels
  const formBox = (sel, k) => page.evaluate((s, kk) => {
    const f = document.querySelector(s), r = f.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), keysTop: document.documentElement.clientHeight - kk, focused: f.contains(document.activeElement) };
  }, sel, k);
  /* Above the keys / room gone are the app's 60 ms fitAboveKeys timer after a visualViewport resize, so each
     is polled until it holds or UI ms pass. Holding once is not the claim; staying is. The fixed reads this
     replaced (300 and 400 ms after the event) also proved the state had stayed, so a lift undone 250 ms later,
     or padding put back after 200 ms, turned them red. So once it holds, the page runs one 400 ms timer and
     the assertion is on the reading taken after it. Timers fire in order of due time, so every timer the app
     has set to fire within those 400 ms runs first, however slow the machine. kb0 is not polled: the toggle's
     click (openForm) shows and focuses the field synchronously, and with no keys up that timer changes
     nothing, so the 300 ms before kb0 waits for nothing and cannot race. */
  const settled = async (read, holds) => {
    let last;
    await waitFor(async () => { last = await read(); return holds(last); }, { timeout: UI });
    if (!holds(last)) return last;
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    return read();
  };
  const above = (b) => !!b && b.bottom <= b.keysTop && b.top >= 0;
  await page.evaluate(() => document.querySelector('.ll-email-toggle').click());
  await sleep(300);
  const kb0 = await formBox('.ll-email-form', KEYS);
  ok('the email field has focus and sits where the keys come up, so the next check can fail', kb0.focused && kb0.bottom > kb0.keysTop, kb0);
  await page.evaluate((k) => window.__keys(k), KEYS);
  const kb1 = await settled(() => formBox('.ll-email-form', KEYS), above);
  ok('with the keys up, the email field and Send code are above them', above(kb1), kb1);
  await page.evaluate(() => window.__keys(0));
  const pad = await settled(() => page.evaluate(() => document.getElementById('llAuthOv').style.paddingBottom), (p) => p === '');
  ok('and when the keys go, the room made for them goes too', pad === '', { paddingBottom: pad });

  console.log('\nshe asks for the code and types it in, without leaving');
  await page.evaluate((email) => {
    document.querySelector('.ll-email-toggle').click();
    const f = document.querySelector('.ll-email-form');
    f.querySelector('input').value = email;
    f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, EMAIL);
  await waitFor(() => issued, { timeout: NET });
  ok('the code endpoint was asked for one', !!issued, { issued: !!issued });

  const codeFormShown = !!(await waitFor(() => page.evaluate(() => {
    const cf = document.querySelector('.ll-code-form');
    return !!cf && cf.style.display !== 'none';
  }), { timeout: NET })).value;
  ok('and she is shown somewhere to type it', codeFormShown, { never: 'the code form, within ' + NET / 1000 + ' s of Send code' });

  /* Guarded, because a gate whose failure mode is a stack trace is a worse gate. On the pre-fix build
     there is no code form at all — the old path emails a LINK, which the Auth emulator helpfully prints
     — and an unguarded querySelector threw here, which skipped the two assertions that matter most:
     whether she ends up signed in, and whether anything navigated to get her there. Fail, keep going,
     report everything. */
  if (codeFormShown) {
    await page.evaluate((k) => window.__keys(k), KEYS);
    const kb2 = await settled(() => formBox('.ll-code-form', KEYS), (b) => !!b && b.focused && above(b));
    ok('the code box has focus, and with the keys up it is above them too', !!kb2 && kb2.focused && above(kb2), kb2);
    await page.evaluate(() => window.__keys(0));
    const submittedAt = Date.now();
    await page.evaluate((code) => {
      const cf = document.querySelector('.ll-code-form');
      cf.querySelector('input').value = code;
      cf.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }, '314159');
    /* Signed in and the card gone is what the three checks below read; then the app replacing "Setting
       things up", so 'no uncaught page errors' has watched the whole boot after sign-in. The 4 s from
       Send that this used to sleep stays as the floor of that watch: it is a window for errors to
       arrive in, not a wait for anything, and being slow cannot turn it red. */
    const landed = await waitFor(() => page.evaluate(() => {
      try { return !!(window.LL && LL.auth && LL.auth.currentUser) && !document.querySelector('.ll-email-toggle'); } catch (e) { return false; }
    }), { timeout: NET });
    if (landed.ok) await waitFor(() => page.evaluate(() => !document.getElementById('llAuthOv')), { timeout: NET });
    await sleep(Math.max(0, 4000 - (Date.now() - submittedAt)));
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
  ok('the main flow, whose sender sends no sendRef, asked /api/signin-status nothing', statusAsks.length === 0, statusAsks);

  console.log('\nwhether the email went: twenty-four parents at once, each in her own container');
  const dl = require(path.join(ROOT, 'tools', 'gate_downloads.js'));
  const panelOf = (p) => p.evaluate(() => {
    const note = document.querySelector('.ll-email-note'), cf = document.querySelector('.ll-code-form');
    const st = note && note.querySelector('.ll-mail-status'), lead = note && note.querySelector('.ll-sent-lead');
    const ci = cf && cf.querySelector('input');
    const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
    const text = note ? note.innerText.replace(/\s+/g, ' ').trim() : null;
    const err = note && note.querySelector('.ll-code-err');
    return {
      text,
      lead: text === null ? null : text.split('Not arrived yet?')[0].trim(),   // the resend countdown below it ticks
      leadOnly: lead ? lead.textContent.replace(/\s+/g, ' ').trim() : null,     // the lead's own words, without the status line
      status: shown(st) ? st.innerText.replace(/\s+/g, ' ').trim() : '',
      statusRole: st ? st.getAttribute('role') : null,
      /* M-S4: a live region is announced when its CONTENT changes while it is rendered. One that is
         display:none until the answer may never be read out, so it must be on the page, empty, before. */
      statusRendered: !!st && getComputedStyle(st).display !== 'none' && st.getClientRects().length > 0,
      probe: st ? st.dataset.probe || '' : '',
      error: err && shown(err) ? err.innerText.replace(/\s+/g, ' ').trim() : (text && /did not match|six digits/.test(text) ? text : ''),
      resendRow: !!(note && note.querySelector('.ll-resend-row .ll-resend') && note.querySelector('.ll-changeemail')),
      /* M7-4: under an undeliverable note "Resend email" goes (a resend to a suppressed address is suppressed
         again, and spends the address's hourly codes); "Wrong email?" stays. */
      resendShown: !!note && shown(note.querySelector('.ll-resend')),
      changeShown: !!note && shown(note.querySelector('.ll-changeemail')),
      leadShown: lead ? shown(lead) : !!text,   // a build without the wrapper shows its lead as part of the note
      codeBox: shown(cf), typed: ci ? ci.value : null, focused: !!ci && document.activeElement === ci,
      uid: (window.LL && LL.auth && LL.auth.currentUser && LL.auth.currentUser.uid) || null,
    };
  });
  /* The sign-in screen, settled. A fixed pause alone was not always enough on a busy machine (a run with a
     load average near 9 had no sign-in screen after it), so it then waits for the screen, and a page that
     never draws one fails on that, by name, instead of throwing on a null further on. */
  async function signInShown(p) {
    await sleep(3500);
    await p.waitForSelector('.ll-email-toggle', { timeout: 40000 }).catch(() => ok('the sign-in screen came up within 40 seconds', false));
  }
  /* The fast clock (TIME, at the top), put in once the sign-in screen is up and just before the send, so
     only the panel's own waits are sped up: from the first document on, it also sped up the app's boot
     timers, and under the load of ten contexts one of those took the sign-in screen away. Every wait of
     8 s or more is divided by FAST and recorded as asked. */
  const fastClock = (p) => p.evaluate((F) => {
    const real = window.setTimeout.bind(window);
    window.__waits = [];
    window.setTimeout = function (fn, ms, ...rest) {
      if (typeof ms === 'number' && ms >= 8000) { window.__waits.push(ms); ms = ms / F; }
      return real(fn, ms, ...rest);
    };
  }, FAST);
  async function scene(email, opts) {
    opts = opts || {};
    const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const p = await ctx.newPage();
    await asInstalledIPhone(p);
    if (opts.viewport) await p.setViewport(Object.assign({ deviceScaleFactor: 1, isMobile: true, hasTouch: true }, opts.viewport));
    const perrs = [];
    p.on('pageerror', (e) => perrs.push(e.message));
    await p.goto(URL_, { waitUntil: 'networkidle2', timeout: 45000 });
    await signInShown(p);
    if (opts.fast) await fastClock(p);
    await p.evaluate((em) => {
      document.querySelector('.ll-email-toggle').click();
      const f = document.querySelector('.ll-email-form');
      f.querySelector('input').value = em;
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }, email);
    await sleep(1200);
    const first = await panelOf(p);
    if (first.codeBox && !opts.empty) await p.type('.ll-code-form input', '314');   // she starts typing before any answer comes back
    const typed = await panelOf(p);
    return { ctx, p, perrs, sentAt: sentAt[email] || Date.now(), first, typed };
  }
  const asksFor = (ref) => statusAsks.filter((a) => a.ref === ref);
  const waitUntil = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await sleep(250); } return false; };
  const resendSame = (p) => p.evaluate(() => {          // "Wrong email?", then Send code with the address unchanged
    document.querySelector('.ll-changeemail').click();
    const f = document.querySelector('.ll-email-form');
    f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  });
  const submitCode = (p, code) => p.evaluate((c) => {
    const cf = document.querySelector('.ll-code-form'); cf.querySelector('input').value = c;
    cf.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, code);
  /* Round 7. The copy for "no answer yet", one exact line, so a panel that says anything else fails. */
  const SLOW = 'It can take a few minutes to arrive. You can also continue with Google or Apple now.';
  /* Where things are on her screen, in CSS pixels: [top, bottom, left, right], or null when not shown. The
     keys cover everything below keysTop (the stood-in keyboard: the visual viewport's height). */
  const geom = (p) => p.evaluate(() => {
    const R = (el) => {
      if (!el || !el.getClientRects().length || getComputedStyle(el).display === 'none') return null;
      const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.right)];
    };
    const st = document.querySelector('.ll-mail-status'), ci = document.querySelector('.ll-code-form input');
    return {
      vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight, keysTop: Math.round(window.visualViewport.height),
      page: document.documentElement.scrollWidth,
      focused: !!ci && document.activeElement === ci, typed: ci ? ci.value : null,
      statusText: st ? st.textContent.replace(/\s+/g, ' ').trim() : '',
      status: st && st.textContent.trim() ? R(st) : null,
      row: R(document.querySelector('.ll-email-row')), emailForm: R(document.querySelector('.ll-email-form')),
      codeForm: R(document.querySelector('.ll-code-form')), codeInput: R(ci), codeBtn: R(document.querySelector('.ll-code-form button')),
      note: R(document.querySelector('.ll-email-note')), lead: R(document.querySelector('.ll-sent-lead')),
      google: R(document.querySelector('#llAuthOv .ll-cta')), apple: R(document.querySelector('#llAuthOv .ll-apple-cta')),
      change: R(document.querySelector('.ll-changeemail')), resend: R(document.querySelector('.ll-resend')),
      err: (() => { const e = document.querySelector('.ll-code-err'); return e && e.textContent.trim() ? R(e) : null; })(),
    };
  });
  const inView = (r, bottom) => !!r && r[0] >= 0 && r[1] <= bottom;
  /* M7-7: as much room on the right as on the left, and some on both. */
  const gutters = (r, vw) => !!r && r[2] >= 16 && Math.abs(r[2] - (vw - r[3])) <= 1;
  /* Screenshots for a person to read (IOS_SIGNIN_SHOTS=<folder>): the keys are drawn in as a grey block. */
  const shot = async (p, name) => {
    if (!process.env.IOS_SIGNIN_SHOTS) return;
    await p.evaluate(() => {
      let k = document.getElementById('__keysShade');
      const h = document.documentElement.clientHeight - window.visualViewport.height;
      if (!k) { k = document.createElement('div'); k.id = '__keysShade'; document.body.appendChild(k); }
      k.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;background:rgba(60,60,60,.55);height:' + h + 'px';
    });
    await p.screenshot({ path: path.join(process.env.IOS_SIGNIN_SHOTS, name + '.png') });
    await p.evaluate(() => { const k = document.getElementById('__keysShade'); if (k) k.remove(); });
  };
  const P375 = { width: 375, height: 667 }, P320 = { width: 320, height: 568 };
  const KEYS375 = 300, KEYS320 = 260;   // an iPhone keyboard with its suggestions bar, at each size
  const toSize = async (p, size, keys) => {
    await p.setViewport(Object.assign({ deviceScaleFactor: 1, isMobile: true, hasTouch: true }, size));
    await p.evaluate((k) => { window.__keys(0); window.__keys(k); }, keys);
    await sleep(500);
  };

  const runGone = async () => {
    const s = await scene('gone@example.test');
    await s.p.evaluate(() => { const st = document.querySelector('.ll-mail-status'); if (st) st.dataset.probe = 'before'; });
    await waitUntil(async () => !!(await panelOf(s.p)).status, 15000);
    const v = await panelOf(s.p);
    const took = asksFor(REFS.gone).length ? asksFor(REFS.gone)[0].at - s.sentAt : -1;
    ok('undeliverable: before any answer the panel says what it always said', /^Check your inbox: we just emailed gone@example\.test\./.test(s.first.text || '') && !s.first.status, s.first);
    ok('undeliverable: before any answer the status line is already on the page, rendered and empty (M-S4)', s.first.statusRendered && s.first.statusRole === 'status' && s.first.status === '', s.first);
    ok('undeliverable: and the answer changes only that line\'s words, in the same element', v.probe === 'before' && v.statusRendered, v);
    ok('undeliverable: the first ask comes about 8 seconds after the send, not sooner', took >= 7500 && took <= 11000, took);
    ok('undeliverable: she is told plainly that it did not reach her address, and shown the other doors',
      /We couldn’t get that email to gone@example\.test, so no code is on its way\. Check the address, or continue with Google or Apple\./.test(v.status), v);
    ok('undeliverable: "check your inbox" is gone, and the line is announced (role=status)', !v.leadShown && v.statusRole === 'status', v);
    ok('undeliverable: the code box is still open, with her focus and the digits she typed', v.codeBox && v.focused && v.typed === '314', v);
    ok('undeliverable: no em-dash or en-dash in what she reads', !!v.status && !/[—–]/.test(v.status), v.status);
    ok('undeliverable: "Resend email" is gone, and "Wrong email?" stays (M7-4)', !v.resendShown && v.changeShown, v);
    /* The narrowest phone: the note wraps inside the card, nothing scrolls sideways, and the row has the
       same gutter on the right as on the left (M7-7: it ran to the screen's edge, 22 px left and 0 right). */
    for (const size of [{ width: 320, height: 640 }, P375]) {
      await s.p.setViewport(Object.assign({ deviceScaleFactor: 1, isMobile: true, hasTouch: true }, size));
      await sleep(400);
      const g = await geom(s.p);
      await shot(s.p, 'gone-' + size.width);
      ok('undeliverable: at ' + size.width + 'px the row, the code box and the note keep a gutter on both sides, and nothing scrolls sideways',
        g.page <= size.width && ['row', 'codeForm', 'status', 'note'].every((k) => gutters(g[k], g.vw)) && !!g.codeBtn && Math.abs((g.vw - g.codeBtn[3]) - g.row[2]) <= 1,
        { vw: g.vw, page: g.page, row: g.row, codeForm: g.codeForm, codeBtn: g.codeBtn, status: g.status, note: g.note });
    }
    await s.p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    /* She taps "Wrong email?", sees the address is right and sends it again inside the minute. No new email
       goes out (the cooldown answers cached), and "We already sent an email ... so use that one" would send
       her back to wait for the one that could not come. The note must stay, and that line must not appear. */
    /* The resend redraws the note, so its status line is a NEW live region. What it says must arrive after
       the region is on the page, or a screen reader may treat it as part of the page and never read it. */
    await s.p.evaluate(() => {
      window.__atInsert = [];
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('ll-mail-status')) window.__atInsert.push(n.textContent); })
        .observe(document.querySelector('.ll-email-note'), { childList: true, subtree: true });
    });
    await resendSame(s.p);
    await sleep(1500);
    const again = await panelOf(s.p);
    ok('undeliverable, then the same address again inside the minute: the note stays and "use that one" is not shown',
      /We couldn’t get that email to gone@example\.test/.test(again.status) && !again.leadShown && !/use that one/.test(again.text || '') && again.codeBox && !again.resendShown, again);
    const atInsert = await s.p.evaluate(() => window.__atInsert);
    ok('undeliverable, then again: the redrawn line is on the page empty first, and the note arrives after (M-S4)', atInsert.length === 1 && atInsert[0] === '' && !!again.status, atInsert);
    const n = asksFor(REFS.gone).length;
    /* The redraw gave her a fresh box (showCodeBox empties it, as it always has), so she types it all. */
    await s.p.evaluate(() => { const ci = document.querySelector('.ll-code-form input'); ci.value = ''; ci.focus(); });
    await s.p.type('.ll-code-form input', '314159');
    await s.p.evaluate(() => document.querySelector('.ll-code-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
    await waitUntil(async () => (await panelOf(s.p)).uid === 'IOSGONE', 8000);
    const after = await panelOf(s.p);
    ok('undeliverable: and a code that did arrive still signs her in', after.uid === 'IOSGONE', after);
    ok('undeliverable: asking stopped at that settled answer', n === 1 && asksFor(REFS.gone).length === 1, asksFor(REFS.gone).length);
    ok('undeliverable: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  const runArrived = async () => {
    const s = await scene('arrived@example.test', { fast: true });
    await waitUntil(async () => !!(await panelOf(s.p)).status, 15000);
    const v = await panelOf(s.p);
    ok('delivered: she is told it arrived, and where it may be hiding', /^It’s been delivered\. If it isn’t in your inbox, have a look in Spam or Promotions\.$/.test(v.status), v);
    ok('delivered: "check your inbox" stays, and the code box keeps her focus and her digits', v.leadShown && v.codeBox && v.focused && v.typed === '314', v);
    ok('delivered: "Resend email" and "Wrong email?" both stay', v.resendShown && v.changeShown, v);
    await sleep(Math.max(0, s.sentAt + 50000 / FAST - Date.now()));   // past the 20- and 45-second asks, on this clock
    ok('delivered: once it is known, nothing more is asked', asksFor(REFS.arrived).length === 1, asksFor(REFS.arrived).length);
    const later = await panelOf(s.p);
    ok('delivered: and past 45 seconds the line is still the delivered one, never "it can take a few minutes" (M7-3)', later.status === v.status && !/few minutes/.test(later.text || ''), later);
    ok('delivered: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  /* Every text the status line is given, as it is given, with the time (round 7: "once"). */
  const watchStatus = (p) => p.evaluate(() => {
    window.__statusSeen = [];
    const st = document.querySelector('.ll-mail-status');
    if (st) new MutationObserver((ms) => { for (const m of ms) if (m.type === 'childList' && st.textContent.trim()) window.__statusSeen.push({ text: st.textContent.trim(), t: Date.now() }); })
      .observe(st, { childList: true, characterData: true, subtree: true });
  });
  const runQuiet = async () => {
    const s = await scene('quiet@example.test', { fast: true });
    await watchStatus(s.p);
    await waitUntil(async () => asksFor(REFS.quiet).length >= 2, 30000);
    await sleep(300);
    const v = await panelOf(s.p);
    ok('unknown (companion): two asks answered unknown, and the panel says nothing new', asksFor(REFS.quiet).length >= 2 && v.lead === s.typed.lead && !v.status && v.leadShown, { asks: asksFor(REFS.quiet).length, before: s.typed.lead, now: v.lead, status: v.status });
    ok('unknown (companion): the code box keeps her focus and her digits', v.codeBox && v.focused && v.typed === '314', v);
    await sleep(Math.max(0, s.sentAt + 99000 / FAST + 1500 - Date.now()));    // past the last ask, at 90 seconds on this clock
    /* Each ask's time since the send, on the page's clock (real milliseconds times FAST), in seconds. */
    const asks = asksFor(REFS.quiet).map((a) => Math.round((a.at - s.sentAt) * FAST / 1000));
    ok('unknown (companion): it backs off and stops: four asks, near 8, 20, 45 and 90 seconds', asks.length === 4 && asks[0] >= 7 && asks[0] <= 12 && asks[1] >= 19 && asks[1] <= 25 && asks[2] >= 44 && asks[2] <= 51 && asks[3] >= 89 && asks[3] <= 97, asks);
    /* The same schedule as the waits the panel itself asked for. Without this a panel asking every 2, 3, 6
       and 11 real seconds (no wait long enough to be sped up) would pass the line above. */
    const waits = await s.p.evaluate(() => window.__waits || []);
    const want = [8000, 12000, 25000, 45000];
    let k = 0; for (const w of waits) if (k < want.length && w === want[k]) k++;
    ok('unknown (companion): the panel asked to wait 8, 12, 25 and 45 seconds, in that order', k === want.length, waits);
    const end = await panelOf(s.p);
    /* M7-3. No settled answer by 45 seconds (a sending-only key answers unknown to every ask): the line says
       so once, and points to the other doors. Nothing else changes: not the lead, not her box. */
    ok('unknown, nothing settled by 45 seconds: the line says, once, that it can take a few minutes and that Google or Apple is there now (M7-3)',
      end.status === SLOW && end.leadOnly === s.typed.leadOnly && end.leadShown && end.codeBox && end.focused && end.typed === '314' && end.resendShown && end.changeShown, end);
    const seen = await s.p.evaluate(() => window.__statusSeen);
    const third = asksFor(REFS.quiet)[2];
    ok('unknown: written once, after the 45-second ask had come back unknown (its answer was held 400 ms)', seen.length === 1 && seen[0].text === SLOW && !!third && seen[0].t >= third.at + 300, { seen, third: third && third.at });
    ok('unknown: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  const runOld = async () => {
    const before = statusAsks.length;
    const s = await scene('old@example.test', { fast: true });
    await sleep(Math.max(0, s.sentAt + 30000 / FAST - Date.now()));   // 30 seconds on this clock
    const v = await panelOf(s.p);
    ok('an older Worker: the panel reads exactly as it did, and nothing new appears',
      v.lead === s.first.lead && v.lead === 'Check your inbox: we just emailed old@example.test. Type the 6-digit code from that email here.' && !v.status && v.leadShown, { first: s.first.lead, now: v.lead, status: v.status });
    ok('an older Worker: the code box keeps her focus and her digits', v.codeBox && v.focused && v.typed === '314', v);
    /* M7-3: no sendRef at all, so nothing can be asked, and still she is not left waiting with no way in. */
    await sleep(Math.max(0, s.sentAt + 50000 / FAST - Date.now()));
    const w = await panelOf(s.p);
    ok('an older Worker, 45 seconds on: the line says it can take a few minutes, and Google or Apple is there now (M7-3)',
      w.status === SLOW && w.leadOnly === s.first.leadOnly && w.leadShown && w.codeBox && w.focused && w.typed === '314', w);
    const strays = statusAsks.slice(before).filter((a) => !Object.values(REFS).includes(a.ref));
    ok('an older Worker (no sendRef): no status is ever asked', strays.length === 0, strays);
    ok('an older Worker: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  const runLinkOnly = async () => {
    const s = await scene('linkonly@example.test');
    await waitUntil(async () => !!(await panelOf(s.p)).status, 15000);
    const v = await panelOf(s.p);
    ok('undeliverable, an email with no code in it: the note does not promise a code', !s.first.codeBox && /We couldn’t get that email to linkonly@example\.test, so it won’t arrive\. Check the address, or continue with Google or Apple\./.test(v.status), v);
    await s.p.setViewport({ width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await sleep(400);
    await shot(s.p, 'linkonly-320');
    ok('undeliverable, no code: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  /* M-S1. The note told her to check the address. She taps "Wrong email?", sees it is right, and sends it
     again inside the minute. The cooldown answers (cached, and later not cached) without saying what it
     knows, so only the panel's own memory can keep "use that one" off her screen. */
  const runWrong = async () => {
    const s = await scene('wrong@example.test', { fast: true });
    await waitUntil(async () => !!(await panelOf(s.p)).status, 15000);
    const v = await panelOf(s.p);
    ok('wrong email?: the undeliverable note is shown first', /We couldn’t get that email to wrong@example\.test/.test(v.status) && !v.leadShown, v);
    await resendSame(s.p);
    await sleep(1200);
    const a = await panelOf(s.p);
    ok('wrong email?, then the same address inside the minute (cached): the note stays and "use that one" is not shown',
      /We couldn’t get that email to wrong@example\.test, so no code is on its way\./.test(a.status) && !a.leadShown && !/use that one/.test(a.text || '') && a.codeBox, a);
    await resendSame(s.p);
    await sleep(1200);
    const b = await panelOf(s.p);
    ok('and again, answered from the cooldown but not cached: the note stays, and "check your inbox" does not come back',
      /We couldn’t get that email to wrong@example\.test/.test(b.status) && !b.leadShown && !/Check your inbox/.test(b.text || '') && b.codeBox, b);
    ok('wrong email?: that settled answer was not asked for again', asksFor(REFS.wrong).length === 1, asksFor(REFS.wrong).length);
    await resendSame(s.p);
    await waitUntil(async () => /Check your inbox/.test((await panelOf(s.p)).text || ''), 8000);
    await sleep(400);
    const c = await panelOf(s.p);
    ok('and when Firebase\'s own sender mails it instead, the old note goes: that is a different email', /Check your inbox: we just emailed wrong@example\.test/.test(c.text || '') && c.leadShown && !c.status, c);
    ok('wrong email?: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  /* M-S1, a reload: the new page knows nothing, and the Worker's cooldown answer carries the state. */
  const runReload = async () => {
    const s = await scene('reload@example.test', { fast: true });
    await waitUntil(async () => !!(await panelOf(s.p)).status, 15000);
    const asked = asksFor(REFS.reload).length;
    await s.p.reload({ waitUntil: 'networkidle2', timeout: 45000 });
    await signInShown(s.p);
    await fastClock(s.p);
    await s.p.evaluate(() => {
      document.querySelector('.ll-email-toggle').click();
      const f = document.querySelector('.ll-email-form');
      f.querySelector('input').value = 'reload@example.test';
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await sleep(1200);
    const v = await panelOf(s.p);
    ok('a reload inside the minute: the cooldown\'s state is shown at once, and "use that one" is not',
      /We couldn’t get that email to reload@example\.test, so no code is on its way\./.test(v.status) && !v.leadShown && !/use that one/.test(v.text || ''), v);
    ok('a reload: the code box is open, with her focus', v.codeBox && v.focused, v);
    ok('a reload: "Resend email" is gone under that note, and "Wrong email?" stays (M7-4)', !v.resendShown && v.changeShown, v);
    await sleep(2500 * 2);   // past two asks on this clock, had it started any
    ok('a reload: a cooldown answer has no sendRef, so nothing more is asked', asked === 1 && asksFor(REFS.reload).length === 1, [asked, asksFor(REFS.reload).length]);
    ok('a reload: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  /* M-S2. A wrong code, before and after the answer, must not wipe what the panel learned. Real clock, so
     the wrong code lands well before the first ask at 8 seconds. */
  const runBadCode = async () => {
    const s = await scene('badcode@example.test');
    await s.p.type('.ll-code-form input', '999');           // 314999: not her code
    await s.p.evaluate(() => document.querySelector('.ll-code-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
    await sleep(800);
    const a = await panelOf(s.p);
    ok('a wrong code before the answer: she is told it did not match', /That code did not match/.test(a.error) && asksFor(REFS.badcode).length === 0, a);
    ok('and she still has Resend and "Wrong email?"', a.resendRow, a);
    await waitUntil(async () => !!(await panelOf(s.p)).status, 15000);
    const b = await panelOf(s.p);
    ok('the undeliverable answer still reaches her after a wrong code', /We couldn’t get that email to badcode@example\.test/.test(b.status) && asksFor(REFS.badcode).length === 1, b);
    await submitCode(s.p, '000000');
    await sleep(800);
    const c = await panelOf(s.p);
    ok('a wrong code after the answer: the note stays beside the error', /We couldn’t get that email to badcode@example\.test/.test(c.status) && /That code did not match/.test(c.error), c);
    if (process.env.IOS_SIGNIN_SHOT_BADCODE) {   // the error, the note and the resend row together, at the narrowest phone
      await s.p.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await s.p.evaluate(() => { const ov = document.getElementById('llAuthOv'); if (ov) ov.scrollTop = ov.scrollHeight; });   // the overlay scrolls, not the page
      await sleep(400);
      await s.p.screenshot({ path: process.env.IOS_SIGNIN_SHOT_BADCODE });
      await s.p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    }
    await submitCode(s.p, '12');
    await sleep(300);
    const d = await panelOf(s.p);
    ok('a short code: "six digits", and the note still stays', /six digits/.test(d.error) && /We couldn’t get that email/.test(d.status), d);
    await submitCode(s.p, '314159');
    await waitUntil(async () => (await panelOf(s.p)).uid === 'IOSBAD', 8000);
    ok('and her right code still signs her in', (await panelOf(s.p)).uid === 'IOSBAD');
    ok('wrong code: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  /* M-S8. Asking stops when she signs in, or when the panel leaves the screen, before anything settles.
     The panel has one stop, "this row is no longer on the page", and a sign-in reaches it the real way:
     the auth state change redraws the overlay and takes the row with it. So the signed-in parent below is
     the proof that a sign-in does that, and the parent whose panel is simply removed is the proof that
     the stop is about the panel, not about being signed in (a stop on auth.currentUser alone keeps
     asking for her). */
  const runStopper = async () => {
    const s = await scene('stopper@example.test', { fast: true });
    await waitUntil(async () => asksFor(REFS.stopper).length >= 1, 15000);
    await submitCode(s.p, '314159');
    await waitUntil(async () => (await panelOf(s.p)).uid === 'IOSSTOP', 8000);
    const inAt = Date.now();
    const signedIn = (await panelOf(s.p)).uid === 'IOSSTOP';
    await sleep(Math.max(0, s.sentAt + 50000 / FAST - Date.now()));   // past the asks at 20 and 45 s on this clock
    const late = asksFor(REFS.stopper).filter((a) => a.at > inAt);
    ok('signed in before any answer: nothing is asked after she is in', signedIn && late.length === 0, { signedIn, asks: asksFor(REFS.stopper).map((a) => a.at - s.sentAt), inAt: inAt - s.sentAt });
    ok('signed in: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  const runLeaver = async () => {
    const s = await scene('leaver@example.test', { fast: true });
    await waitUntil(async () => asksFor(REFS.leaver).length >= 1, 15000);
    const goneAt = await s.p.evaluate(() => { const ov = document.getElementById('llAuthOv'); if (ov) ov.remove(); return !document.querySelector('.ll-email-row'); }) ? Date.now() : 0;
    await sleep(Math.max(0, s.sentAt + 50000 / FAST - Date.now()));
    const late = asksFor(REFS.leaver).filter((a) => a.at > goneAt);
    ok('the panel left the screen before any answer: nothing more is asked', goneAt > 0 && late.length === 0, { goneAt: goneAt && goneAt - s.sentAt, asks: asksFor(REFS.leaver).map((a) => a.at - s.sentAt) });
    ok('panel gone: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  /* ---- Round 7 (R6M2-1, M7-1): every note she needs is above the keys. ----
     In the installed app she asks for a code and waits in the code box with the keys up, the designed flow
     (autocomplete=one-time-code waits for iOS to offer the code from Mail). The note sat under the box, so
     under the keys, and "We couldn't get that email to you" was never seen: the incident, repeated. Each
     parent below raises the stood-in keyboard over the code box before any answer, then the answer comes. */
  async function keysUp(email, size, keys, opts) {
    const s = await scene(email, Object.assign({ fast: true, viewport: size }, opts || {}));
    await s.p.evaluate((k) => window.__keys(k), keys);
    await sleep(500);
    s.before = await geom(s.p);
    await watchStatus(s.p);
    return s;
  }
  const settle = async (s) => { await waitUntil(async () => !!(await geom(s.p)).statusText, 20000); await sleep(800); return geom(s.p); };
  /* Undeliverable, and her box is empty: there is nothing of hers to keep, so the panel lets go of the box,
     the keys go down, and she sees the note and the Google and Apple buttons. Then a code that did come still
     works: she taps the box, the keys come up over the box and the note, and it signs her in. */
  const runKeysEmpty = (email, uid, size, keys, tag) => async () => {
    const s = await keysUp(email, size, keys, { empty: true });
    ok('keys ' + tag + ', empty box: before the answer the code box is above the keys, so the checks below can fail', inView(s.before.codeForm, s.before.keysTop) && s.before.focused && s.before.keysTop < s.before.vh, s.before);
    const g = await settle(s);
    await shot(s.p, 'keys-empty-' + tag);
    ok('keys ' + tag + ', empty box, undeliverable: the panel lets go of the box and the keys go down', !g.focused && g.typed === '' && g.keysTop === g.vh, { focused: g.focused, typed: g.typed, keysTop: g.keysTop, vh: g.vh });
    /* On her screen = above the keys, if any are still up (keysTop is the screen's bottom once they go). */
    ok('keys ' + tag + ', empty box, undeliverable: the note is on her screen, whole', /We couldn’t get that email to/.test(g.statusText) && inView(g.status, g.keysTop), { status: g.status, keysTop: g.keysTop, text: g.statusText });
    ok('keys ' + tag + ', empty box, undeliverable: and so are Continue with Google and Continue with Apple', inView(g.google, g.keysTop) && inView(g.apple, g.keysTop), { google: g.google, apple: g.apple, keysTop: g.keysTop });
    ok('keys ' + tag + ', empty box, undeliverable: "Wrong email?" is on her screen, and "Resend email" is not offered', inView(g.change, g.keysTop) && !g.resend, { change: g.change, resend: g.resend, keysTop: g.keysTop });
    await s.p.focus('.ll-code-form input');
    await s.p.evaluate((k) => window.__keys(k), keys);
    await sleep(500);
    const h = await geom(s.p);
    await shot(s.p, 'keys-empty-' + tag + '-again');
    ok('keys ' + tag + ', she taps the box again: the box, the note and "Wrong email?" all sit above the keys', h.focused && inView(h.codeForm, h.keysTop) && inView(h.status, h.keysTop) && inView(h.change, h.keysTop), { codeForm: h.codeForm, status: h.status, change: h.change, keysTop: h.keysTop });
    await s.p.type('.ll-code-form input', '314159');
    await submitCode(s.p, '314159');
    await waitUntil(async () => (await panelOf(s.p)).uid === uid, 8000);
    ok('keys ' + tag + ', and a code that did come still signs her in', (await panelOf(s.p)).uid === uid);
    ok('keys ' + tag + ', empty box: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  const runKeysEmpty375 = runKeysEmpty('kempty@example.test', 'IOSKEMPTY', P375, KEYS375, '375');
  const runKeysEmpty320 = runKeysEmpty('kempty320@example.test', 'IOSKEMPTY320', P320, KEYS320, '320');
  /* The others keep her focus (a box she typed into is never let go; delivered and "it can take a few
     minutes" never let go at all), so the block above the keys is the code box AND the line under it. Each
     is checked at 375 px, where the line arrives while the keys are up, and at 320 px, where the keys come
     up over a line that is already there. */
  const runKeysKept = (email, tag, label, want, opts) => async () => {
    const s = await keysUp(email, P375, KEYS375, opts);
    ok('keys, ' + label + ': before the answer the code box is above the keys, so the checks below can fail', inView(s.before.codeForm, s.before.keysTop) && s.before.focused, s.before);
    const g = await settle(s);
    const typed = opts && opts.empty ? '' : '314';
    await shot(s.p, 'keys-' + tag + '-375');
    ok('keys 375, ' + label + ': the line is the right one, and her box keeps its focus and what she typed', want.test(g.statusText) && g.focused && g.typed === typed, { text: g.statusText, focused: g.focused, typed: g.typed });
    ok('keys 375, ' + label + ': the line is above the keys, whole, and so are the box and "Wrong email?"', inView(g.status, g.keysTop) && inView(g.codeForm, g.keysTop) && inView(g.change, g.keysTop), { status: g.status, codeForm: g.codeForm, change: g.change, keysTop: g.keysTop });
    await toSize(s.p, P320, KEYS320);
    const n = await geom(s.p);
    await shot(s.p, 'keys-' + tag + '-320');
    ok('keys 320, ' + label + ': the keys come up over a line already there, and the line, the box and "Wrong email?" are above them', n.focused && n.typed === typed && inView(n.status, n.keysTop) && inView(n.codeForm, n.keysTop) && inView(n.change, n.keysTop), { status: n.status, codeForm: n.codeForm, change: n.change, keysTop: n.keysTop });
    if (opts && opts.wrongCode) {
      /* A wrong code, typed and sent with the keys still up: "That code did not match" is a note she needs too. */
      await submitCode(s.p, '000000');
      await sleep(900);
      const e = await geom(s.p);
      await shot(s.p, 'keys-' + tag + '-320-wrongcode');
      ok('keys 320, ' + label + ', then a wrong code: the error, the line, the box and "Wrong email?" are all above the keys', !!e.err && inView(e.err, e.keysTop) && inView(e.status, e.keysTop) && inView(e.codeForm, e.keysTop) && inView(e.change, e.keysTop), { err: e.err, status: e.status, codeForm: e.codeForm, change: e.change, keysTop: e.keysTop });
    }
    ok('keys, ' + label + ': no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  const runKeysTyped = runKeysKept('ktyped@example.test', 'typed', 'undeliverable after she typed', /We couldn’t get that email to ktyped@example\.test/);
  const runKeysArrived = runKeysKept('karrived@example.test', 'arrived', 'delivered, empty box', /^It’s been delivered\./, { empty: true, wrongCode: true });
  const runKeysSlow = runKeysKept('kslow@example.test', 'slow', 'slow (no answer by 45 seconds)', new RegExp('^' + SLOW.replace(/[.?]/g, '\\$&') + '$'));

  /* ---- Round 7 (R6M2-2, M7-2/M7-3): a reload before the first ask, and a cooldown answer that knows
     nothing settled (a sending-only key, or Resend has not decided yet). The new page has no sendRef, so it
     cannot ask; the cooldown answer is the panel's whole knowledge. It must not leave her with "use that
     one" alone: a cooldown answer means the email went out up to a minute ago, so 15 seconds on, the line
     says it can take a few minutes and that Google or Apple is there now. ---- */
  const runReload2 = async () => {
    const s = await scene('reload2@example.test');                 // real clock: the reload comes before the 8-second ask
    await sleep(1500);
    await s.p.reload({ waitUntil: 'networkidle2', timeout: 45000 });
    await signInShown(s.p);
    await fastClock(s.p);
    await s.p.evaluate(() => {
      document.querySelector('.ll-email-toggle').click();
      const f = document.querySelector('.ll-email-form');
      f.querySelector('input').value = 'reload2@example.test';
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    const againAt = Date.now();
    await sleep(1200);
    const v = await panelOf(s.p);
    ok('a reload before any ask, and a cooldown answer with nothing settled: "use that one", and nothing more yet', /^We already sent an email to reload2@example\.test in the last minute, so use that one\./.test(v.lead || '') && !v.status && v.codeBox && v.focused, v);
    await sleep(Math.max(0, againAt + 18000 / FAST - Date.now()));
    const w = await panelOf(s.p);
    await shot(s.p, 'reload2-slow-390');
    ok('and 15 seconds on, she is not left with that alone: it can take a few minutes, and Google or Apple is there now (M7-3)', w.status === SLOW && w.leadShown && w.codeBox && w.focused, w);
    ok('a reload before any ask: nothing was asked, before the reload or after it', asksFor(REFS.reload2).length === 0, asksFor(REFS.reload2));
    ok('reload before any ask: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  /* ---- Round 7 (M7-3): the slow line, then a bounce reported at the last ask. The settled answer says more,
     so it replaces the slow line; and nothing is asked after it. ---- */
  const runLate = async () => {
    const s = await scene('late@example.test', { fast: true });
    await watchStatus(s.p);
    await waitUntil(async () => (await panelOf(s.p)).status === SLOW, 20000);
    const a = await panelOf(s.p);
    ok('a late bounce: first, nothing settled by 45 seconds, so the slow line', a.status === SLOW && a.leadShown && a.resendShown, a);
    await waitUntil(async () => /We couldn’t get that email/.test((await panelOf(s.p)).status), 20000);
    await sleep(300);
    const b = await panelOf(s.p);
    ok('then the bounce at 90 seconds replaces it: the undeliverable note, no "check your inbox", no "Resend email"',
      /^We couldn’t get that email to late@example\.test, so no code is on its way\./.test(b.status) && !/few minutes/.test(b.text || '') && !b.leadShown && !b.resendShown && b.changeShown && b.codeBox && b.focused && b.typed === '314', b);
    const seen = await s.p.evaluate(() => window.__statusSeen.map((x) => x.text));
    ok('a late bounce: the line said two things, in that order, once each', seen.length === 2 && seen[0] === SLOW && /^We couldn’t get that email/.test(seen[1]), seen);
    ok('a late bounce: four asks, and none after the bounce', asksFor(REFS.late).length === 4, asksFor(REFS.late).length);
    ok('a late bounce: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  /* ---- Round 7 (R6M2-3, M7-5): the same-address keep condition. Undeliverable for X; "Wrong email?"; a
     different address Y, answered from the cooldown (no sendRef). What the panel knew about X is not Y's. */
  const runWrongOther = async () => {
    const s = await scene('wrongx@example.test', { fast: true });
    await waitUntil(async () => !!(await panelOf(s.p)).status, 15000);
    const v = await panelOf(s.p);
    ok('wrong email?, another address: the undeliverable note for the first is shown first', /We couldn’t get that email to wrongx@example\.test/.test(v.status) && !v.leadShown, v);
    await s.p.evaluate(() => document.querySelector('.ll-changeemail').click());
    /* M7-7, the email row itself: the address field and Send code keep a gutter on both sides too. */
    for (const size of [{ width: 320, height: 640 }, P375]) {
      await s.p.setViewport(Object.assign({ deviceScaleFactor: 1, isMobile: true, hasTouch: true }, size));
      await sleep(400);
      const g = await geom(s.p);
      await shot(s.p, 'email-row-' + size.width);
      ok('the email row at ' + size.width + 'px: the address field and Send code keep a gutter on both sides', g.page <= size.width && gutters(g.row, g.vw) && gutters(g.emailForm, g.vw), { vw: g.vw, row: g.row, emailForm: g.emailForm });
    }
    await s.p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await s.p.evaluate(() => {
      const f = document.querySelector('.ll-email-form');
      f.querySelector('input').value = 'other@example.test';
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await sleep(1200);
    const a = await panelOf(s.p);
    await shot(s.p, 'wrong-other-390');
    ok('then another address, answered from the cooldown: no note about the first address, and the second one\'s own lead',
      !/wrongx@example\.test/.test(a.text || '') && !a.status && a.leadShown && /^We already sent an email to other@example\.test in the last minute, so use that one\./.test(a.lead || '') && a.codeBox, a);
    ok('wrong email?, another address: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };

  /* ---- Round 7, pass 2 (R7M-1): she goes to Mail the moment the email is asked for. ----
     That is the incident's own flow: "Check your inbox", so she checks it. iOS suspends an installed app
     that is off screen: no timer runs while she is away, and the overdue ones run the moment she is back.
     CDP's Page.setWebLifecycleState 'frozen' does the same to a Chrome page. The asks are a chain (8 s, then
     12, 25 and 45 more), so on her return the chain is wherever it stopped: if the slow line waited for the
     45-second step of it, she came back 60 seconds after the send and had it 37 seconds later (the skeptic's
     probe on the real clock; 9 s on this one). The line belongs to the time since the send. */
  /* The send, on the fast clock, and nothing after it: the note is drawn, and no ask has gone yet. */
  const sendOnly = async (email) => {
    const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
    const p = await ctx.newPage();
    await asInstalledIPhone(p);
    const perrs = [];
    p.on('pageerror', (e) => perrs.push(e.message));
    await p.goto(URL_, { waitUntil: 'networkidle2', timeout: 45000 });
    await signInShown(p);
    await fastClock(p);
    await p.evaluate((em) => {
      document.querySelector('.ll-email-toggle').click();
      const f = document.querySelector('.ll-email-form');
      f.querySelector('input').value = em;
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }, email);
    await p.waitForSelector('.ll-email-note .ll-mail-status', { timeout: 10000 });
    return { ctx, p, perrs };
  };
  const away = async (email, backAt) => {
    const { ctx, p, perrs } = await sendOnly(email);
    const cdp = await p.target().createCDPSession();
    await watchStatus(p);
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });          // she is in Mail
    const leftAt = Date.now(), t0 = sentAt[email] || leftAt;
    await sleep(Math.max(0, t0 + backAt / FAST - Date.now()));
    const backing = Date.now();
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });          // and back
    return { ctx, p, perrs, t0, leftAt, backing, back: Date.now() };
  };
  /* What happened while she was away: nothing may have been asked or written, or the scene proves nothing
     (a page that was never suspended shows the line at 45 seconds, before she is "back"). */
  const awayPremise = (s, ref, seen) => {
    const asked = ref ? asksFor(ref).filter((a) => a.at < s.backing) : [];
    return { ok: s.leftAt - s.t0 < 8000 / FAST && asked.length === 0 && seen.every((x) => x.t >= s.backing), leftAfterMs: s.leftAt - s.t0, asked: asked.length, seen };
  };
  const runAway = (email, ref, label) => async () => {
    const s = await away(email, 60000);
    await waitUntil(async () => (await panelOf(s.p)).status === SLOW, 12000);
    const v = await panelOf(s.p);
    const seen = await s.p.evaluate(() => window.__statusSeen);
    const pre = awayPremise(s, ref, seen);
    await shot(s.p, 'away-' + (ref ? 'ref' : 'old') + '-390');
    ok(label + ': she left before the first ask, and nothing was asked or written while she was away', pre.ok, pre);
    /* 3 real seconds is 12 on this clock; the 45-second step of the chain comes 37 seconds (9 real) after her return. */
    ok(label + ': back 60 seconds after the send, the slow line is there within moments of her return, not at the schedule\'s next step',
      seen.length >= 1 && seen[0].text === SLOW && seen[0].t - s.back <= 3000 && v.status === SLOW,
      { afterReturnMs: seen.length ? seen[0].t - s.back : null, seen, asks: ref ? asksFor(ref).map((a) => a.at - s.back) : [] });
    ok(label + ': the code box is still open, with her focus', v.codeBox && v.focused && v.leadShown, v);
    ok(label + ': no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  const runAwayRef = runAway('away@example.test', REFS.away, 'away, with a sendRef');
  const runAwayOld = runAway('awayold@example.test', '', 'away, no sendRef (companion)');
  /* Back BEFORE 45 seconds: the chain's next steps after her return are at 30, 42 and then 67 seconds, and
     the line must still come about 45 seconds after the send, not at 67. */
  const runAwayEarly = async () => {
    const s = await away('awayearly@example.test', 30000);
    await waitUntil(async () => (await panelOf(s.p)).status === SLOW, 15000);
    const seen = await s.p.evaluate(() => window.__statusSeen);
    const pre = awayPremise(s, REFS.awayEarly, seen);
    ok('away until 30 seconds: she left before the first ask, and nothing was asked or written while she was away', pre.ok, pre);
    const atSec = seen.length ? Math.round((seen[0].t - s.t0) * FAST / 1000) : -1;   // seconds since the send, on this clock
    ok('away until 30 seconds: the slow line comes about 45 seconds after the send, not at the 67-second step after her return',
      seen.length >= 1 && seen[0].text === SLOW && atSec >= 40 && atSec <= 52,
      { atSec, asks: asksFor(REFS.awayEarly).map((a) => Math.round((a.at - s.t0) * FAST / 1000)) });
    ok('away until 30 seconds: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  /* A phone that slept. Locked with its screen off, an iPhone can sleep, and its timers count only the time
     it was awake, so it comes back with them behind the wall clock: the 45-second timer could then be most
     of a minute away while the email went minutes ago. Stood in by moving the page's Date.now() a minute
     ahead right after the send, with its timers left where they were. The first answer that is not settled
     (the 8-second ask) must bring the line, not the 45-second timer (the third ask, on this clock). */
  const runSlept = async () => {
    const { ctx, p, perrs } = await sendOnly('slept@example.test');
    const t0 = sentAt['slept@example.test'] || Date.now();
    await p.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 60000; });
    const moved = { afterSendMs: Date.now() - t0, asked: asksFor(REFS.slept).length };
    await waitUntil(async () => (await panelOf(p)).status === SLOW, 15000);
    const asks = asksFor(REFS.slept).length, ms = Date.now() - t0;
    await sleep(300);
    const v = await panelOf(p);
    ok('a phone that slept: its clock moved on before the first ask', moved.asked === 0 && moved.afterSendMs < 8000 / FAST, moved);
    ok('a phone that slept (its timers behind the wall clock): the first answer that is not settled brings the line, not the 45-second timer',
      v.status === SLOW && asks === 1 && ms < 45000 / FAST - 1000, { asks, ms, status: v.status });
    ok('a phone that slept: the code box is still open, with her focus', v.codeBox && v.focused && v.leadShown, v);
    ok('a phone that slept: no page errors', perrs.length === 0, perrs);
    await ctx.close();
  };

  /* ---- Round 7, pass 2 (R7M-2) ----
     A status ask that hangs is given up after 7 seconds (real ones: the give-up is under the fast clock's
     8-second floor), so a dead connection cannot hold the line back for ever. With no give-up she is left
     with "Check your inbox" and nothing else, which is the incident. */
  const runHang = async () => {
    const s = await scene('hang@example.test', { fast: true });
    await watchStatus(s.p);
    await waitUntil(async () => (await panelOf(s.p)).status === SLOW, 40000);
    const v = await panelOf(s.p);
    const seen = await s.p.evaluate(() => window.__statusSeen);
    const at = seen.length ? seen[0].t - s.sentAt : -1;
    await shot(s.p, 'hang-390');
    ok('a status ask that never comes back: it is given up, and the slow line still comes, within that 7-second give-up of the 45-second point',
      asksFor(REFS.hang).length >= 1 && seen.length === 1 && seen[0].text === SLOW && at >= 45000 / FAST && at <= 45000 / FAST + 7000 + 3000,
      { atMs: at, asks: asksFor(REFS.hang).map((a) => a.at - s.sentAt), seen });
    ok('a hung ask: her box keeps its focus and what she typed', v.codeBox && v.focused && v.typed === '314', v);
    ok('a hung ask: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };
  /* New codes are paused, and the code in her newest email still works: no new email went, so "it can take a
     few minutes to arrive" would be untrue. The older-Worker parent (old) is this check's companion: the same
     panel with no sendRef, where the same matcher does find the line. */
  const runLiveCode = async () => {
    const before = statusAsks.length;
    const s = await scene('live@example.test', { fast: true });
    await watchStatus(s.p);
    ok('codes paused, her newest still works: the panel says so, and the box is open with her focus and her digits',
      /^New codes are paused for about 30 minutes, but the code in your most recent email still works for about 7 more minutes\. Type it here\.$/.test(s.typed.leadOnly || '')
      && s.typed.codeBox && s.typed.focused && s.typed.typed === '314', s.typed);
    await sleep(Math.max(0, s.sentAt + 50000 / FAST - Date.now()));   // past 45 seconds, on this clock
    const v = await panelOf(s.p);
    const seen = await s.p.evaluate(() => window.__statusSeen);
    await shot(s.p, 'livecode-390');
    ok('codes paused: 45 seconds on there is no "it can take a few minutes", because no new email went',
      !v.status && seen.length === 0 && !/few minutes/.test(v.text || '') && v.leadOnly === s.typed.leadOnly && v.codeBox && v.focused, { status: v.status, seen, lead: v.leadOnly });
    ok('codes paused: nothing is asked about it', statusAsks.slice(before).filter((a) => !Object.values(REFS).includes(a.ref)).length === 0);
    ok('codes paused: no page errors', s.perrs.length === 0, s.perrs);
    await s.ctx.close();
  };

  /* Started a second apart, so the pages do not all boot in the same instant. IOS_SIGNIN_ONLY=<name,...>
     runs only those parents, for working on one; such a run is never a verdict (it exits 3). */
  const all = [runGone, runArrived, runBadCode, runQuiet, runOld, runLinkOnly, runWrong, runReload, runStopper, runLeaver,
    runKeysEmpty375, runKeysEmpty320, runKeysTyped, runKeysArrived, runKeysSlow, runReload2, runWrongOther, runLate,
    runAwayRef, runAwayEarly, runAwayOld, runSlept, runHang, runLiveCode];
  const names = ['gone', 'arrived', 'badcode', 'quiet', 'old', 'linkonly', 'wrong', 'reload', 'stopper', 'leaver',
    'kempty375', 'kempty320', 'ktyped', 'karrived', 'kslow', 'reload2', 'wrongother', 'late',
    'away', 'awayearly', 'awayold', 'slept', 'hang', 'livecode'];
  const ONLY = String(process.env.IOS_SIGNIN_ONLY || '').split(',').filter(Boolean);
  const runs = all.filter((r, i) => !ONLY.length || ONLY.includes(names[i]));
  if (ONLY.length) console.log('  (IOS_SIGNIN_ONLY=' + ONLY.join(',') + ': ' + runs.length + ' of ' + all.length + ' parents; a partial run, never a verdict)');
  await Promise.all(runs.map((run, i) => sleep(i * 1000).then(run)));

  console.log('\n' + (fail ? 'FAIL' : ONLY.length ? 'PARTIAL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  front.close();
  staticProc.kill();
  process.exit(fail ? 1 : ONLY.length ? 3 : 0);
})().catch((e) => { console.error(e); try { if (staticKid) staticKid.kill(); } catch (x) {} process.exit(1); });
