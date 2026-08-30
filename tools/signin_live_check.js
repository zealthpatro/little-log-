/* Can a person actually get a sign-in code from PRODUCTION, and does it sign them in?
 *
 *   node tools/signin_live_check.js [baseUrl]      default https://little-cubby.com
 *
 * WHY THIS EXISTS, precisely. The one-time-code path is the agreed remedy for a standing P0: every
 * installed iOS home-screen app has its own storage container, so a link completes in Safari and the
 * app stays signed out. The code path shipped 2026-08-19 12:03 and was fixed 2026-08-23 14:44, and for
 * those four days it returned 502 store_failed on EVERY request. The remedy for the outage was itself
 * dead the whole time it was live, and nobody knew.
 *
 * It was "verified" at ship time with a cross-origin 403, a malformed-email 400, and a bad-code 400.
 * Every one of those returns BEFORE the Firestore write. The guards were tested and the feature never
 * was. tools/ios-signin-code.test.js does not cover it either — that harness STUBS these two endpoints
 * so it can run offline, which is right for the client flow and useless for this.
 *
 * So this walks the happy path against the real thing: ask for a code, prove the document was written,
 * exchange it for a custom token, and check the code cannot be replayed.
 *
 * HOW IT READS THE CODE WITHOUT AN INBOX. It does not need one. The code is stored only as an HMAC
 * keyed by HKDF over the service-account private key, so this derives the same key and searches the
 * million candidates for the matching MAC — a few seconds. That is not a weakness in the scheme: it
 * requires the private key, which is the whole secret. It is what lets this run unattended.
 *
 * Needs tools/serviceAccountKey.json (gitignored). Uses a reserved-TLD address so no real mailbox is
 * ever written to, and deletes the account it creates.
 *
 * DELIBERATELY NOT IN tools/gates.js, INCLUDING ITS LIVE_GATES LIST. Please leave it out. The absence
 * looks like an oversight and it is not: the two gates already in LIVE_GATES (thirdparty_gate,
 * claims_audit) only READ production. This one WRITES to it — it issues a real code document, and
 * creates and deletes a real auth account — and it needs the gitignored service-account key, so on any
 * machine without that key it fails for a reason that has nothing to do with the app. Wiring it in
 * would point part of the suite at prod with write access and make `gates.js --live` unrunnable for
 * anyone who has not been handed a private key.
 *
 * Its home is the post-deploy list in OPERATIONS.md, beside `sitesw_gate.js https://little-cubby.com`:
 * things you run yourself, against the live host, after shipping.
 */
'use strict';
const crypto = require('crypto');
const path = require('path');
const BASE = process.argv[2] || 'https://little-cubby.com';
const EMAIL = 'signin-live-check@example.test';

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let initializeApp, cert, getFirestore, getAuth, sa;
  try {
    ({ initializeApp, cert } = require('firebase-admin/app'));
    ({ getFirestore } = require('firebase-admin/firestore'));
    ({ getAuth } = require('firebase-admin/auth'));
  } catch (e) { console.error('\n  Missing firebase-admin. Run:  npm i firebase-admin\n'); process.exit(1); }
  try { sa = require(path.join(__dirname, 'serviceAccountKey.json')); }
  catch (e) { console.error('\n  Missing tools/serviceAccountKey.json (gitignored).\n'); process.exit(1); }
  initializeApp({ credential: cert(sa) });
  const db = getFirestore();

  const b64url = (b) => Buffer.from(b).toString('base64url');
  const bits = crypto.hkdfSync('sha256', Buffer.from(String(sa.private_key || '')), Buffer.alloc(0),
    Buffer.from('cubby-signin-code-v1'), 32);
  const mac = (m) => b64url(crypto.createHmac('sha256', Buffer.from(bits)).update(m).digest());
  const post = (p, body) => fetch(BASE + p, { method: 'POST',
    headers: { 'content-type': 'application/json', Origin: BASE }, body: JSON.stringify(body) });

  console.log('\nasking ' + BASE + ' for a sign-in code');
  let r1 = await post('/api/signin-code', { email: EMAIL });
  let t1 = await r1.text();
  /* The endpoint holds a 60s per-address cooldown and answers a repeat with {ok:true,cached:true},
     writing no new document. Run this twice in a minute and the naive version reports a confident
     FAIL about a service that is perfectly healthy — which is how a check earns a reputation for
     crying wolf and stops being run. Wait it out once, then continue. */
  if (/"cached"\s*:\s*true/.test(t1)) {
    console.log('  (per-address cooldown is holding a previous request — waiting 65s)');
    await sleep(65000);
    r1 = await post('/api/signin-code', { email: EMAIL });
    t1 = await r1.text();
  }
  /* 502 store_failed is the exact shape of the four-day outage: a bare token carries the default
     identitytoolkit scope and Firestore refuses the write. Name it, so the next person does not have
     to rediscover it. */
  ok('the endpoint accepts the request', r1.status === 200,
    { status: r1.status, body: t1.slice(0, 120), hint: r1.status === 502 ? 'store_failed = the Firestore write was refused; check the OAuth scope' : undefined });

  const snap = await db.collection('signinCodes').doc(mac('id:' + EMAIL).slice(0, 32)).get();
  ok('a code document really was written', snap.exists);
  if (!snap.exists) { console.log('\nFAIL — nothing to verify against\n'); process.exit(1); }
  const d = snap.data();
  ok('it expires, and soon', Number(d.exp) > Date.now() && Number(d.exp) - Date.now() <= 15 * 60000,
    { ttlSec: Math.round((Number(d.exp) - Date.now()) / 1000) });
  ok('it holds a MAC, never the code itself', !!d.mac && !/^\d{6}$/.test(String(d.mac)));
  ok('guesses are capped', Number(d.tries) > 0 && Number(d.tries) <= 10, { tries: d.tries });

  let code = null;
  for (let i = 0; i < 1000000 && !code; i++) {
    const c = String(i).padStart(6, '0');
    if (mac('code:' + EMAIL + ':' + c) === d.mac) code = c;
  }
  ok('the stored MAC matches a real six-digit code', !!code);
  if (!code) { console.log('\nFAIL — the MAC scheme changed\n'); process.exit(1); }

  console.log('\nexchanging it for a session');
  const r2 = await post('/api/signin-verify', { email: EMAIL, code });
  const j2 = await r2.json().catch(() => ({}));
  ok('a custom token comes back', r2.status === 200 && !!j2.token, { status: r2.status, body: j2 });
  if (j2.token) {
    let claims = {};
    try { claims = JSON.parse(Buffer.from(j2.token.split('.')[1], 'base64url').toString()); } catch (e) {}
    ok('and it names a uid to sign in as', !!claims.uid, { uid: claims.uid });
    ok('addressed to Identity Toolkit', /identitytoolkit/.test(String(claims.aud)));
  }

  console.log('\nand it cannot be used twice');
  const r3 = await post('/api/signin-verify', { email: EMAIL, code });
  ok('replaying the same code is refused', r3.status === 400, { status: r3.status });
  const r4 = await post('/api/signin-verify', { email: EMAIL, code: code === '000000' ? '111111' : '000000' });
  ok('a wrong code is refused', r4.status === 400, { status: r4.status });

  try { const u = await getAuth().getUserByEmail(EMAIL); await getAuth().deleteUser(u.uid); console.log('\n  (probe account removed)'); }
  catch (e) { /* never created, fine */ }

  console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
