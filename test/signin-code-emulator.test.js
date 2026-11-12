/* The sign-in code, driven through the REAL worker.js against a REAL Firestore (the emulator).
 *
 * WHY THIS EXISTS. Round 1 of the guess-budget fix (audit server-1, identity-signin-code-attempt-race)
 * passed every stubbed test and would still have broken every code sign-in. Its conditional writes
 * sent the precondition as a query string, ?currentDocument.updateTime=<RFC3339>, and the emulator
 * reads that as base version 0: every spend was refused, so every CORRECT code answered bad_code and
 * every reissue fell back to link-only. The stubs agreed with the code, because the same person wrote
 * both. Only a Firestore we did not write can say which write shapes it accepts, so this file stubs
 * nothing about storage: Firestore calls go to the emulator, and only Google's token endpoint,
 * Identity Toolkit and Resend (which have no emulator here) are faked.
 *
 * It covers what a parent does (the right code on try 1 and try 5, a miss then the right code, a
 * resend after a miss), what an attacker does (fifty guesses at once, a reissue to reset the budget),
 * the double-tapped correct code (30 rounds as they fall, 30 with the race forced; exactly one sign-in
 * each), the canary's own spend, and
 * that no plaintext address is left at rest in signinCodes.
 *
 *   cd test && npx firebase-tools emulators:exec --only firestore --project demo-cubby "node signin-code-emulator.test.js"
 *   (or FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> node test/signin-code-emulator.test.js against a running one)
 *
 * The emulator's `Bearer owner` credential stands in for the service account, the same way
 * push-query.test.js does it. Rules are not under test here (signinCodes is deny-all to clients).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const done = () => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SIGNIN-CODE-EMU: FAIL' : 'SIGNIN-CODE-EMU: PASS');
  process.exit(fail ? 1 : 0);
};

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
if (!EMU) { console.log('  FAIL FIRESTORE_EMULATOR_HOST is not set: this test needs the Firestore emulator'); fail++; done(); }

const PROJECT = 'demo-cubby';
const HOST = 'https://little-cubby.com';
const { privateKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SA = { project_id: PROJECT, client_email: 'cubby@demo-cubby.iam.gserviceaccount.com', private_key: privateKey };
const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), RESEND_API_KEY: 're_test' };   // no ALERT_EMAIL: the canary mails nobody
const DOCS = 'http://' + EMU + '/v1/projects/' + PROJECT + '/databases/(default)/documents';

const mail = [], cache = new Map(), users = new Map();
globalThis.caches = { default: {
  async match(r) { const v = cache.get(String(r.url)); return v === undefined ? undefined : new Response(v); },
  async put(r, res) { cache.set(String(r.url), await res.text()); },
} };

/* Count every HMAC compare: that is a guess being evaluated, whatever the response says. */
let evaluated = 0;
const subtle = globalThis.crypto.subtle;
const realVerify = subtle.verify.bind(subtle);
subtle.verify = function (alg) { if (((alg && alg.name) || alg) === 'HMAC') evaluated++; return realVerify.apply(null, arguments); };

const realFetch = globalThis.fetch;
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
const writes = {};   // status tally of every Firestore write, so a refused write shape is visible in the output
/* The one thing this harness does to the traffic: with holdBurns on, a delete of a code document is
   held until two spends of that document have landed (bounded at 500ms). That forces the
   interleaving which signed a double tap in twice, instead of hoping 30 rounds stumble on it.
   Firestore itself still decides every write. */
let holdBurns = false;
const spendsLanded = new Map();
const docOf = (url, body) => {
  if (/:commit$/.test(url)) { const wr = (JSON.parse(body || '{}').writes || [])[0] || {}; return { name: String((wr.update && wr.update.name) || wr.delete || '').split('/documents/')[1] || '', del: !!wr.delete, spend: !!(wr.updateMask && (wr.updateMask.fieldPaths || []).indexOf('tries') > -1) }; }
  const q = url.split('?'); return { name: (q[0].split('/documents/')[1] || ''), del: false, spend: /updateMask\.fieldPaths=tries/.test(q[1] || '') };
};
globalThis.fetch = async (input, init) => {
  let url = String(input && input.url ? input.url : input);
  const method = ((init && init.method) || 'GET').toUpperCase();
  const body = init && init.body;
  if (url.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 't', expires_in: 3600 });
  if (url.includes('accounts:sendOobCode')) return J({ oobLink: 'https://x.firebaseapp.com/__/auth/action?mode=signIn&oobCode=O&apiKey=k' });
  if (/accounts:lookup$/.test(url)) { const e = (JSON.parse(body || '{}').email || [])[0]; return users.has(e) ? J({ users: [{ localId: users.get(e) }] }) : J({}); }
  if (/\/accounts$/.test(url) && method === 'POST') { const b = JSON.parse(body); const u = 'uid' + (users.size + 1); users.set(b.email, u); return J({ localId: u }); }
  if (url === 'https://api.resend.com/emails') { mail.push(JSON.parse(body)); return J({ id: 'm' + mail.length }); }
  if (url.startsWith('https://firestore.googleapis.com/')) {
    url = url.replace('https://firestore.googleapis.com/', 'http://' + EMU + '/');
    const h = Object.assign({}, (init && init.headers) || {}, { authorization: 'Bearer owner' });
    const d = method === 'GET' ? null : docOf(url, body);
    if (d && (d.del || method === 'DELETE') && holdBurns) {
      for (let i = 0; i < 500 && (spendsLanded.get(d.name) || 0) < 2; i++) await new Promise((r) => setTimeout(r, 1));
    }
    const r = await realFetch(url, Object.assign({}, init, { headers: h }));
    if (d) {
      const k = method + ' ' + r.status; writes[k] = (writes[k] || 0) + 1;
      if (d.spend && r.ok) spendsLanded.set(d.name, (spendsLanded.get(d.name) || 0) + 1);
    }
    return r;
  }
  throw new Error('unstubbed external call: ' + method + ' ' + url);
};

const post = (w, p, b) => w.fetch(new Request(HOST + p, { method: 'POST', headers: { 'content-type': 'application/json', Origin: HOST }, body: JSON.stringify(b) }), ENV, { waitUntil() {}, passThroughOnException() {} });
const lastCode = () => { const m = String(mail[mail.length - 1].html).match(/>(\d{6})</g); return m ? m[m.length - 1].replace(/\D/g, '') : null; };
const wrong = (c, k) => String((Number(c) + 1 + (k || 0)) % 1e6).padStart(6, '0');
let serial = 0;
const fresh = (tag) => tag + '-' + process.pid + '-' + (++serial) + '@example.com';
async function issue(w, email) { cache.clear(); const r = await post(w, '/api/signin-code', { email }); return { status: r.status, body: await r.json().catch(() => ({})) }; }
async function verify(w, email, code) { const r = await post(w, '/api/signin-verify', { email, code }); return { status: r.status, body: await r.json().catch(() => ({})) }; }
const signedIn = (v) => v.status === 200 && !!v.body.token;
async function listCodes() {
  const r = await realFetch(DOCS + '/signinCodes?pageSize=300', { headers: { authorization: 'Bearer owner' } });
  return r.ok ? ((await r.json()).documents || []) : [];
}

(async () => {
  // Start from an empty emulator so a document left by an earlier run cannot decide a verdict.
  await realFetch('http://' + EMU + '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });

  const src = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-emu-signin-'));
  for (const im of src.matchAll(/^import\s[^;]*?from\s+['"](\.\/[^'"]+)['"]/gm)) {
    const to = path.join(dir, im[1]); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(__dirname, '..', im[1]), to);
  }
  fs.writeFileSync(path.join(dir, 'worker.mjs'), src);
  const mod = await import(pathToFileURL(path.join(dir, 'worker.mjs')).href);
  const w = mod.default;

  console.log('\n1. a real parent, against a real Firestore');
  for (const k of [1, 2, 5]) {
    const e = fresh('try' + k);
    const iss = await issue(w, e);
    ok('try ' + k + ': the code is sent', iss.status === 200 && iss.body.hasCode === true, iss);
    const c = lastCode();
    for (let i = 0; i < k - 1; i++) await verify(w, e, wrong(c, i));
    const v = await verify(w, e, c);
    ok('try ' + k + ': the right code signs her in' + (k === 2 ? ' (one miss, then the right one)' : ''), signedIn(v), [v.status, v.body.error]);
    const again = await verify(w, e, c);
    ok('try ' + k + ': and it works once', again.status === 400, again.status);
  }
  {
    const e = fresh('resend');
    await issue(w, e); const first = lastCode();
    await verify(w, e, wrong(first, 0));
    const re = await issue(w, e);
    ok('a resend after a miss sends a new code (the conditional replace is accepted)', re.status === 200 && re.body.hasCode === true, re);
    const second = lastCode();
    ok('the old code is dead after the resend', (await verify(w, e, first)).status === 400);
    const v = await verify(w, e, second);
    ok('and the new one signs her in', signedIn(v), [v.status, v.body.error]);
  }

  console.log('\n2. no plaintext address is kept in signinCodes');
  {
    const e = fresh('atrest');
    await issue(w, e);
    await verify(w, e, wrong(lastCode(), 0));   // a doc that has been spent on, too
    const docs = await listCodes();
    ok('there are code documents to look at', docs.length > 0, docs.length);
    const raw = JSON.stringify(docs);
    ok('none of them holds an email address', !/@example\.com/.test(raw), docs.map((d) => Object.keys(d.fields || {})));
  }

  console.log('\n3. fifty wrong guesses at once, then the right one');
  {
    const e = fresh('storm');
    await issue(w, e); const c = lastCode();
    evaluated = 0;
    const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => verify(w, e, wrong(c, i))));
    const storm = evaluated;
    ok('nobody in the storm signed in', rs.every((r) => r.status !== 200), [...new Set(rs.map((r) => r.status))]);
    ok('at most 5 of the 50 guesses were compared', storm <= 5, storm);
    ok('and the storm really reached the compare (the spends were accepted)', storm >= 1, storm);
    const after = await verify(w, e, c);
    ok('the right code afterwards is refused: the code is dead', after.status === 400, after.status);
    ok('and it was never compared', evaluated === storm, evaluated - storm);
  }

  console.log('\n4. a reissue does not reset the guess budget');
  {
    const e = fresh('budget');
    evaluated = 0;
    await issue(w, e); let c = lastCode();
    for (let i = 0; i < 3; i++) await verify(w, e, wrong(c, i));
    await issue(w, e); c = lastCode();
    for (let i = 0; i < 5; i++) await verify(w, e, wrong(c, i));
    const third = await issue(w, e);
    ok('a third code can still be sent after 8 misses', third.status === 200 && third.body.hasCode === true, third);
    c = lastCode();
    for (let i = 0; i < 2; i++) await verify(w, e, wrong(c, i));
    ok('ten guesses compared across three codes', evaluated === 10, evaluated);
    const right = await verify(w, e, c);
    ok('the right code as the 11th guess in an hour does not sign in', right.status !== 200, right.status);
    ok('it gets the polite try-later answer the limiter already gives', right.status === 429 && right.body.error === 'rate_limited', right);
    ok('and the 11th guess was never compared', evaluated === 10, evaluated);
    const mailed = mail.length;
    const fourth = await issue(w, e);
    ok('no fourth code is minted this hour', fourth.status !== 200 && mail.length === mailed, [fourth, mail.length - mailed]);
    cache.clear();
    const link = await post(w, '/api/send-signin-link', { email: e });
    const lb = await link.json();
    ok('but the link email still goes out, honestly without a code', link.status === 200 && lb.hasLink === true && lb.hasCode === false, lb);
  }

  for (const forced of [false, true]) {
  console.log('\n5' + (forced ? 'b' : 'a') + '. a double-tapped correct code signs her in exactly once (30 rounds' + (forced ? ', the second spend forced in before the first burn)' : ', as they fall)'));
  {
    const tally = {}; let flakes = 0;
    holdBurns = forced;
    for (let round = 0; round < 30; round++) {
      const e = fresh('dbl');
      await issue(w, e); const c = lastCode();
      const both = await Promise.all([verify(w, e, c), verify(w, e, c)]);
      const wins = both.filter(signedIn).length;
      const shape = both.map((v) => v.status + (v.body.error ? ':' + v.body.error : '')).sort().join(',');
      tally[shape] = (tally[shape] || 0) + 1;
      if (wins !== 1 || both.some((v) => v.status >= 500)) flakes++;
    }
    holdBurns = false;
    console.log('       outcomes over 30 rounds: ' + JSON.stringify(tally));
    ok('every round signed in exactly once, and the other tap was a plain bad_code', flakes === 0, { flakes, tally });
  }
  }

  console.log('\n6. the sign-in canary drives a real spend and comes back green');
  {
    const v = await mod.signinCanary(ENV);
    ok('the canary is green against a real Firestore', v.ok === true, v.reason);
    ok('and it really spent: its verdict names the miss and the burn', /miss spent one try/.test(String(v.reason)) && /burned/.test(String(v.reason)), v.reason);
    const left = (await listCodes()).length;
    const beat = await realFetch(DOCS + '/ops/canary', { headers: { authorization: 'Bearer owner' } }).then((r) => r.json());
    ok('and it recorded a green heartbeat', !!(beat.fields && beat.fields.ok && beat.fields.ok.booleanValue === true), beat.fields);
    const again = await mod.signinCanary(ENV);
    ok('a second run is green too (it leaves nothing that caps the next one)', again.ok === true, again.reason);
    ok('and the canary leaves no code document behind', (await listCodes()).length === left, [left, (await listCodes()).length]);
  }

  console.log('\nFirestore write statuses:', JSON.stringify(writes));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  done();
})().catch((e) => { console.error(e); fail++; done(); });
