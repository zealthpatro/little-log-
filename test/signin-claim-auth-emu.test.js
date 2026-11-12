/* A code sign-in that claims an unproven account keeps HER one account, judged by the real Auth emulator.
 *
 * WHY THIS EXISTS. Round 5 closed NP-1: anyone could make a password account on a parent's address
 * without ever proving it, and when she later signed in by code the Worker handed her that same
 * account, squatter still inside. The fix claims such an account before minting her session: it marks
 * the address proven, removes the squatter's password, and revokes his refresh tokens. The first
 * version removed the password with deleteProvider:['password']. Every stubbed test was green, because
 * the stubs only flipped a flag. The real Auth emulator read that call as "unlink email sign-in" and
 * cleared the account's email too, so her session carried no email, and her NEXT code sign-in found no
 * account for her address and made a second one: her family on one uid, her new session on another,
 * and on the installed iPhone app (code is the only way in) no way back. deleteAttribute:['PASSWORD']
 * removes the password and keeps the email.
 *
 * So this file stubs nothing about identity. Identity Toolkit calls go to the Auth emulator and
 * Firestore calls to the Firestore emulator; only Google's token endpoint and Resend are faked.
 *
 *   node test/signin-claim-auth-emu.test.js
 *
 * It stands its own emulators up on FS_PORT (default 8797) and AUTH_PORT (default 9797), hub and
 * logging and the Firestore websocket on HUB_PORT / LOG_PORT / WS_PORT (4797 / 4798 / 9798), so it never lands on someone else's emulator. FIREBASE_BIN
 * names the CLI when test/node_modules is not linked (a fresh worktree). Run with
 * FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST already set to use running ones instead.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const PROJECT = 'demo-cubby';
const FS_PORT = Number(process.env.FS_PORT) || 8797;
const AUTH_PORT = Number(process.env.AUTH_PORT) || 9797;
const HUB_PORT = Number(process.env.HUB_PORT) || 4797;
const LOG_PORT = Number(process.env.LOG_PORT) || 4798;
const WS_PORT = Number(process.env.WS_PORT) || 9798;

/* ---------- outer phase: stand the emulators up, then re-run ourselves inside ---------- */
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-claimauth-'));
  fs.writeFileSync(path.join(scratch, 'closed.rules'),
    "rules_version = '2';\nservice cloud.firestore { match /databases/{db}/documents { match /{document=**} { allow read, write: if false; } } }\n");
  fs.writeFileSync(path.join(scratch, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'closed.rules' },
    emulators: { firestore: { port: FS_PORT, websocketPort: WS_PORT }, auth: { port: AUTH_PORT }, hub: { port: HUB_PORT }, logging: { port: LOG_PORT }, ui: { enabled: false } }
  }));
  const firebaseBin = process.env.FIREBASE_BIN || path.join(__dirname, 'node_modules', '.bin', 'firebase');
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '/opt/homebrew/opt/openjdk/bin';
  const env = Object.assign({}, process.env, { PATH: javaBin + ':' + process.env.PATH });
  try {
    execFileSync(firebaseBin, [
      'emulators:exec', '--only', 'firestore,auth', '--project', PROJECT,
      '--config', path.join(scratch, 'firebase.json'),
      `node ${JSON.stringify(__filename)}`
    ], { cwd: scratch, env, stdio: 'inherit' });
  } catch (e) { process.exitCode = e.status || 1; }
  return;
}

/* ---------- inner phase ---------- */
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const done = () => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SIGNIN-CLAIM-AUTH: FAIL' : 'SIGNIN-CLAIM-AUTH: PASS');
  process.exit(fail ? 1 : 0);
};

const FSE = process.env.FIRESTORE_EMULATOR_HOST;
const AUE = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const HOST = 'https://little-cubby.com';
const { privateKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SA = { project_id: PROJECT, client_email: 'cubby@demo-cubby.iam.gserviceaccount.com', private_key: privateKey };
const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), RESEND_API_KEY: 're_test' };

const mail = [], cache = new Map(), itk = [];
globalThis.caches = { default: {
  async match(r) { const v = cache.get(String(r.url)); return v === undefined ? undefined : new Response(v); },
  async put(r, res) { cache.set(String(r.url), await res.text()); },
} };
const realFetch = globalThis.fetch;
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
const admin = (init) => Object.assign({}, init, { headers: Object.assign({}, (init && init.headers) || {}, { authorization: 'Bearer owner' }) });
globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const method = ((init && init.method) || 'GET').toUpperCase();
  if (url.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 't', expires_in: 3600 });
  if (url === 'https://api.resend.com/emails') { mail.push(JSON.parse(init.body)); return J({ id: 'm' + mail.length }); }
  if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
    itk.push(method + ' ' + url.split('/').pop());
    return realFetch(url.replace('https://identitytoolkit.googleapis.com/', 'http://' + AUE + '/identitytoolkit.googleapis.com/'), admin(init));
  }
  if (url.startsWith('https://firestore.googleapis.com/')) return realFetch(url.replace('https://firestore.googleapis.com/', 'http://' + FSE + '/'), admin(init));
  throw new Error('unstubbed external call: ' + method + ' ' + url);
};

/* The Auth emulator, spoken to as a client would (a squatter, an Apple sign-in) or as the admin. */
const AU = 'http://' + AUE + '/identitytoolkit.googleapis.com/v1';
const call = async (url, body, asAdmin) => { const r = await realFetch(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, asAdmin ? { authorization: 'Bearer owner' } : {}), body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const signUp = (email, password) => call(AU + '/accounts:signUp?key=fake', { email, password, returnSecureToken: true });
const signInPw = (email, password) => call(AU + '/accounts:signInWithPassword?key=fake', { email, password, returnSecureToken: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const signInIdp = (provider, email, verified) => call(AU + '/accounts:signInWithIdp?key=fake', { requestUri: 'http://localhost', returnSecureToken: true,
  postBody: 'id_token=' + b64({ alg: 'none' }) + '.' + b64({ sub: 'sub-' + email, email, email_verified: verified, iss: '', aud: '' }) + '.&providerId=' + provider });
const lookupEmail = async (email) => (await call(AU + '/projects/' + PROJECT + '/accounts:lookup', { email: [email] }, true)).body.users || [];
const lookupId = async (id) => ((await call(AU + '/projects/' + PROJECT + '/accounts:lookup', { localId: [id] }, true)).body.users || [])[0] || null;
const redeem = async (tok) => {
  const r = await call(AU + '/accounts:signInWithCustomToken?key=fake', { token: tok, returnSecureToken: true });
  if (r.status !== 200) return { status: r.status, error: r.body.error };
  const c = JSON.parse(Buffer.from(r.body.idToken.split('.')[1], 'base64url').toString());
  return { status: 200, uid: c.user_id, email: c.email || null, email_verified: c.email_verified === true };
};
const shape = (u) => u && ({ email: u.email || null, emailVerified: u.emailVerified === true, providers: (u.providerUserInfo || []).map((p) => p.providerId), hasPassword: !!u.passwordHash, validSince: u.validSince || null });
const uidOf = (tok) => { try { return JSON.parse(Buffer.from(String(tok).split('.')[1], 'base64url').toString()).uid; } catch (e) { return null; } };

const post = (w, p, b) => w.fetch(new Request(HOST + p, { method: 'POST', headers: { 'content-type': 'application/json', Origin: HOST, 'CF-Connecting-IP': '198.51.100.20' }, body: JSON.stringify(b) }), ENV, { waitUntil() {}, passThroughOnException() {} });
const lastCodeTo = (to) => { for (let i = mail.length - 1; i >= 0; i--) if ([].concat(mail[i].to).includes(to)) { const m = String(mail[i].html).match(/>(\d{6})</g); return m ? m[m.length - 1].replace(/\D/g, '') : null; } return null; };
/* One code sign-in, the way the app does it: ask for a code, type the one in her inbox. */
async function codeSignIn(w, email) {
  cache.clear();                                    // past the one-a-minute resend cooldown
  const a = await post(w, '/api/signin-code', { email });
  const code = lastCodeTo(email);
  const v = await post(w, '/api/signin-verify', { email, code });
  const body = await v.json().catch(() => ({}));
  return { asked: a.status, status: v.status, token: body.token || null, uid: uidOf(body.token) };
}
let serial = 0;
const fresh = (tag) => tag + '-' + process.pid + '-' + (++serial) + '@example.com';

(async () => {
  await realFetch('http://' + FSE + '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  await realFetch('http://' + AUE + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });

  const src = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-claimauth-w-'));
  for (const im of src.matchAll(/^import\s[^;]*?from\s+['"](\.\/[^'"]+)['"]/gm)) {
    const to = path.join(dir, im[1]); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(__dirname, '..', im[1]), to);
  }
  fs.writeFileSync(path.join(dir, 'worker.mjs'), src);
  const w = (await import(pathToFileURL(path.join(dir, 'worker.mjs')).href)).default;

  console.log('\n1. a squatter made a password account on her address; she signs in by code');
  {
    const V = fresh('mum');
    const sq = await signUp(V, 'squatter-password-1');
    ok('the squatter\'s account exists, unproven (the premise)', sq.status === 200 && (await lookupId(sq.body.localId)).emailVerified !== true, sq.status);
    const first = await codeSignIn(w, V);
    const acct = await lookupId(sq.body.localId);
    ok('her code signs her in', first.status === 200 && !!first.token, first);
    ok('into the one account that holds her address', first.uid === sq.body.localId, { session: first.uid, account: sq.body.localId });
    ok('that account still carries her email', !!acct && acct.email === V, shape(acct));
    ok('and now counts her address as proven', !!acct && acct.emailVerified === true, shape(acct));
    ok('the squatter\'s password is gone from it', !!acct && !acct.passwordHash, shape(acct));
    const pw = await signInPw(V, 'squatter-password-1');
    ok('so his password no longer signs in', pw.status !== 200, pw.status);
    const red = await redeem(first.token);
    ok('her session says who she is: her email, proven', red.status === 200 && red.email === V && red.email_verified, red);
    const second = await codeSignIn(w, V);
    ok('her NEXT code sign-in lands in the same account, not a new one', second.status === 200 && second.uid === first.uid, { first: first.uid, second: second.uid });
    const all = await lookupEmail(V);
    ok('and her address still names exactly one account', all.length === 1 && all[0].localId === sq.body.localId, all.map((u) => u.localId));
  }

  console.log('\n2. no attacker: an Apple sign-in the emulator records as unproven');
  {
    const E = fresh('applemum');
    const ap = await signInIdp('apple.com', E, false);
    ok('the Apple account exists (the premise)', ap.status === 200 && !!ap.body.localId, ap.status);
    const first = await codeSignIn(w, E);
    const acct = await lookupId(ap.body.localId);
    ok('her code sign-in lands in her Apple account', first.uid === ap.body.localId, { session: first.uid, account: ap.body.localId });
    ok('which keeps its email', !!acct && acct.email === E, shape(acct));
    ok('and keeps Sign in with Apple', !!acct && (acct.providerUserInfo || []).some((p) => p.providerId === 'apple.com'), shape(acct));
    const second = await codeSignIn(w, E);
    ok('her next code sign-in lands there too', second.uid === ap.body.localId, { first: first.uid, second: second.uid });
  }

  console.log('\n3. companions: accounts that need no claim are left exactly as they are');
  {
    const N = fresh('newmum');
    const made = await codeSignIn(w, N);
    const acct = made.uid ? await lookupId(made.uid) : null;
    ok('a brand-new address gets an account carrying her proven email', made.status === 200 && !!acct && acct.email === N && acct.emailVerified === true, shape(acct));
    const before = shape(await lookupId(made.uid));
    const n0 = itk.filter((c) => /accounts:update$/.test(c)).length;
    await new Promise((r) => setTimeout(r, 1100));           // so a needless validSince bump would show
    const again = await codeSignIn(w, N);
    const after = shape(await lookupId(made.uid));
    ok('her second sign-in is the same account', again.uid === made.uid, { first: made.uid, second: again.uid });
    ok('and a proven account is never updated (no claim call, validSince unchanged)', itk.filter((c) => /accounts:update$/.test(c)).length === n0 && before.validSince === after.validSince, { before, after });
  }

  done();
})().catch((e) => { console.error(e); fail++; done(); });
