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

/* users: address -> { uid, verified }. Accounts are made by the worker, verified; an account whose
   lookup came back unverified would be claimed with accounts:update (worker.js getOrCreateUidByEmail),
   recorded in updates. */
const mail = [], cache = new Map(), users = new Map(), updates = [];
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
let oobDown = false;   // section 7c: Identity Toolkit refuses to mint a link
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
  if (url.includes('accounts:sendOobCode') && oobDown) return J({ error: { message: 'UNAVAILABLE' } }, 503);
  if (url.includes('accounts:sendOobCode')) return J({ oobLink: 'https://x.firebaseapp.com/__/auth/action?mode=signIn&oobCode=O&apiKey=k' });
  if (/accounts:lookup$/.test(url)) { const e = (JSON.parse(body || '{}').email || [])[0]; const u = users.get(e); return u ? J({ users: [Object.assign({ localId: u.uid, email: e }, u.verified ? { emailVerified: true } : {})] }) : J({}); }
  if (/accounts:update$/.test(url) && method === 'POST') { const b = JSON.parse(body); updates.push(b); for (const u of users.values()) if (u.uid === b.localId && b.emailVerified) u.verified = true; return J({ localId: b.localId }); }
  if (/\/accounts$/.test(url) && method === 'POST') { const b = JSON.parse(body); const u = 'uid' + (users.size + 1); users.set(b.email, { uid: u, verified: b.emailVerified === true }); return J({ localId: u }); }
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

/* ip, when given, is the client's network (CF-Connecting-IP): the hourly ceilings are split by it. */
const post = (w, p, b, ip, env) => w.fetch(new Request(HOST + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', Origin: HOST }, ip ? { 'CF-Connecting-IP': ip } : {}), body: JSON.stringify(b) }), env || ENV, { waitUntil() {}, passThroughOnException() {} });
const lastCode = () => { const m = String(mail[mail.length - 1].html).match(/>(\d{6})</g); return m ? m[m.length - 1].replace(/\D/g, '') : null; };
const wrong = (c, k) => String((Number(c) + 1 + (k || 0)) % 1e6).padStart(6, '0');
let serial = 0;
const fresh = (tag) => tag + '-' + process.pid + '-' + (++serial) + '@example.com';
async function issue(w, email, ip) { cache.clear(); const r = await post(w, '/api/signin-code', { email }, ip); return { status: r.status, body: await r.json().catch(() => ({})) }; }
async function verify(w, email, code, ip) { const r = await post(w, '/api/signin-verify', { email, code }, ip); return { status: r.status, body: await r.json().catch(() => ({})) }; }
const signedIn = (v) => v.status === 200 && !!v.body.token;
/* The worker's document id for an address, derived here the way worker.js derives it (HKDF of the
   service-account key, then an HMAC), so a section can read one address's document and nobody
   else's. Every section that uses it first checks the document it names really exists. */
const SIGNIN_KEY = Buffer.from(nodeCrypto.hkdfSync('sha256', Buffer.from(privateKey), Buffer.alloc(0), Buffer.from('cubby-signin-code-v1'), 32));
const docIdFor = (email) => nodeCrypto.createHmac('sha256', SIGNIN_KEY).update('id:' + email).digest('base64url').slice(0, 32);
async function codeFields(email) {
  const r = await realFetch(DOCS + '/signinCodes/' + docIdFor(email), { headers: { authorization: 'Bearer owner' } });
  return r.ok ? ((await r.json()).fields || {}) : null;
}
const tagsIn = (f) => (((f && f.issues && f.issues.arrayValue && f.issues.arrayValue.values) || []).map((v) => String(v.stringValue).split(':')[1]));
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

  console.log('\n4. a reissue does not reset the guess budget (one network), and the budget is split by network');
  {
    const e = fresh('budget');
    const A = '198.51.100.7', B = '2001:db8:aa:1::5';
    evaluated = 0;
    await issue(w, e, A); let c = lastCode();
    for (let i = 0; i < 3; i++) await verify(w, e, wrong(c, i), A);
    const second = await issue(w, e, A);
    ok('a second code can still be sent after 3 misses', second.status === 200 && second.body.hasCode === true, second);
    c = lastCode();
    for (let i = 0; i < 2; i++) await verify(w, e, wrong(c, i), A);
    ok('five guesses compared across two codes', evaluated === 5, evaluated);
    const right = await verify(w, e, c, A);
    ok('the right code as that network\'s 6th guess in an hour does not sign in', right.status !== 200, right.status);
    ok('it gets the try-later answer, with how long to wait', right.status === 429 && right.body.error === 'rate_limited' && right.body.retryAfter > 60, right);
    ok('and the 6th guess was never compared', evaluated === 5, evaluated);
    const mailed = mail.length;
    const third = await issue(w, e, A);
    ok('no further code is minted for that network this hour', third.status === 429 && mail.length === mailed && third.body.retryAfter > 60, [third, mail.length - mailed]);
    cache.clear();
    const link = await post(w, '/api/send-signin-link', { email: e }, A);
    const lb = await link.json();
    ok('but the link email still goes out, honestly without a code', link.status === 200 && lb.hasLink === true && lb.hasCode === false, lb);
    // THE LOCKOUT, closed. Those guesses were a stranger's. Her phone is another network.
    const hers = await issue(w, e, B);
    ok('her phone, on another network, still gets a code', hers.status === 200 && hers.body.hasCode === true, hers);
    const v = await verify(w, e, lastCode(), B);
    ok('and that code signs her in, against a real Firestore', signedIn(v), [v.status, v.body.error]);
    const docs = JSON.stringify(await listCodes());
    ok('no client address is stored, only a keyed tag', !docs.includes('198.51.100') && !docs.includes('2001:db8'), docs.slice(0, 200));
  }

  console.log('\n4b. many networks: the per-address total still bounds guessing');
  {
    const e = fresh('many');
    evaluated = 0;
    for (const ip of ['192.0.2.1', '192.0.2.2']) {
      await issue(w, e, ip); const c = lastCode();
      for (let i = 0; i < 5; i++) await verify(w, e, wrong(c, i), ip);
    }
    await issue(w, e, '192.0.2.3'); const c3 = lastCode();
    for (let i = 0; i < 4; i++) await verify(w, e, wrong(c3, i), '192.0.2.3');
    await issue(w, e, '192.0.2.5'); const live = lastCode();
    await verify(w, e, wrong(live, 0), '192.0.2.5');
    ok('fifteen guesses compared across four networks', evaluated === 15, evaluated);
    const r = await verify(w, e, live, '192.0.2.5');
    ok('the right code past the address total is refused without a compare', r.status === 429 && evaluated === 15, [r.status, evaluated]);
    const d = await issue(w, e, '192.0.2.4');
    ok('and a fourth network gets no code', d.status === 429, d);
  }

  console.log('\n4c. a document the previous build wrote (integer spentAt/issuedAt) still counts');
  {
    const e = fresh('legacy');
    await issue(w, e, '192.0.2.9');
    const now = Date.now();
    // The newest document is the one just issued for this address (ids are keyed hashes, by design).
    const target = (await listCodes()).sort((x, y) => (x.updateTime < y.updateTime ? 1 : -1))[0];
    const ints = (n) => ({ arrayValue: { values: Array.from({ length: n }, (_, i) => ({ integerValue: String(now - 1000 * (i + 1)) })) } });
    // Add the old shape alongside: 15 misses this hour, with no network recorded.
    const patch = await realFetch('http://' + EMU + '/v1/' + target.name + '?updateMask.fieldPaths=spentAt', {
      method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { spentAt: ints(15) } })
    });
    ok('the old-shape window is seeded', patch.ok, patch.status);
    const v = await verify(w, e, lastCode(), '192.0.2.9');
    ok('fifteen misses recorded by the previous build still cap the address', v.status === 429, [v.status, v.body]);
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

  /* 7. What the panel SAYS after a Resend inside the 60s cooldown. The worker's cooldown reply is
     only half of it; the other half is app/store-firebase.js turning that reply into a code box or
     not. So this section runs the client's own wireEmailRow (cut from the real file, not retyped)
     over a fake DOM, with its fetch wired straight into the worker under test, and reads back what
     a parent would see. The bug it pins: an address at its hourly cap gets a LINK-only email from
     the fallback sender, and a Resend inside the minute came back {cached:true}, which the client
     reads as "that email had a code", so she was told to type six digits that are not there.
     Reachable with no attacker at all: five sends in an hour, then Send and Resend. */
  console.log('\n7. a Resend inside the cooldown shows what the last email really holds');
  {
    const csrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'store-firebase.js'), 'utf8');
    const a = csrc.indexOf('  function wireEmailRow(scope) {'), b = csrc.indexOf('\n  function maybeFinishEmailLink');
    ok('the client panel code was found in app/store-firebase.js', a > -1 && b > a, [a, b]);
    // Its two one-line helpers come from the same file, so nothing here is a retyped copy.
    const escSrc = ['escHtml', 'looksLikeEmail'].map((n) => (csrc.match(new RegExp('^  function ' + n + '\\(.*$', 'm')) || [''])[0]).join('\n');
    ok('and its helpers', /function escHtml/.test(escSrc) && /function looksLikeEmail/.test(escSrc), escSrc);
    /* The panel also records its sign-in steps through signinTrack (spec §8.3), which lives with its state at
       the top of the file. Taken whole from there too; with no window here it is a silent no-op. */
    const t0 = csrc.indexOf('  var _signinTries = {};'), t1 = csrc.indexOf('\n  var LOCAL_PREFS_KEY');
    const trackSrc = t0 > -1 && t1 > t0 ? csrc.slice(t0, t1) : '';
    ok('and the sign-in step recorder it calls', /function signinTrack\(/.test(trackSrc) && /function signinErr\(/.test(trackSrc), [t0, t1]);
    const wire = new Function('SEND_LABEL', 'errText', 'auth', 'location', 'localStorage', 'fetch', 'setInterval', 'clearInterval', 'isStandaloneApp', 'isIOSDevice',
      escSrc + '\n' + trackSrc + '\n' + csrc.slice(a, b) + '\nreturn wireEmailRow;');
    const el = () => ({ style: {}, value: '', textContent: '', disabled: false, focus() {}, select() {} });
    function panel(opts) {
      opts = opts || {};
      const input = el(), btn = el(), ci = el(), cb = el();
      const form = Object.assign(el(), { querySelector: (s) => (s === 'input' ? input : btn) });
      const codeForm = Object.assign(el(), { querySelector: (s) => (s === 'input' ? ci : cb) });
      let html = '', kids = {};
      const note = {
        style: {},
        get innerHTML() { return html; },
        set innerHTML(v) { html = String(v); kids = { '.ll-resend': el(), '.ll-changeemail': el(), '.ll-resend-row': el() }; },
        get textContent() { return html.replace(/<[^>]*>/g, ''); },
        set textContent(v) { html = String(v); kids = {}; },
        querySelector: (s) => kids[s] || null,
      };
      const parts = { '.ll-email-toggle': el(), '.ll-email-form': form, '.ll-email-note': note, '.ll-code-form': codeForm };
      const row = { querySelector: (s) => parts[s] || null };
      const calls = []; let inflight = 0;
      const cfetch = async (p, init) => {
        inflight++;
        try {
          const r = await post(w, p, JSON.parse(init.body), undefined, opts.env);
          calls.push(p + ' ' + r.status);
          return r;
        } finally { inflight--; }
      };
      const fbAuth = { sendSignInLinkToEmail: async () => { calls.push('firebase-sender'); }, signInWithCustomToken: async () => { calls.push('signed-in'); return {}; } };
      const inApp = opts.inApp ? () => true : undefined;   // the installed iPhone app: standalone AND iOS
      wire('Send code', (e, fb) => fb, fbAuth, { origin: HOST }, { setItem() {}, getItem() { return null; } }, cfetch, () => 1, () => {}, inApp, inApp)({ querySelector: (s) => (s === '.ll-email-row' ? row : null) });
      const settle = async () => {
        // Quiet for 10 ticks in a row: the code request, its fallback and the redraw have all landed.
        let quiet = 0;
        for (let i = 0; i < 3000 && quiet < 10; i++) { await new Promise((r) => setTimeout(r, 1)); quiet = inflight === 0 ? quiet + 1 : 0; }
      };
      return {
        calls,
        async send(email) { input.value = email; form.onsubmit({ preventDefault() {} }); await settle(); },
        async resend() { const rb = note.querySelector('.ll-resend'); if (!rb || !rb.onclick) throw new Error('no Resend button on the panel'); rb.onclick(); await settle(); },
        seen() { return { codeBox: codeForm.style.display !== 'none' && codeForm.style.display !== undefined, text: note.textContent }; },
        // No box wired means nothing to type into: say so in the calls, so the section goes red instead of throwing.
        async submitCode(code) { if (typeof codeForm.onsubmit !== 'function') { calls.push('no-code-box'); return; } ci.value = code; codeForm.onsubmit({ preventDefault() {} }); await settle(); },
      };
    }
    const asksForCode = (s) => s.codeBox || /6-digit code/.test(s.text);

    // 7a. The cap, reached the ordinary way: five codes in an hour, each a minute or more apart, and
    // the newest of them used up (here by five wrong guesses from another network), so no code in her
    // inbox still works. With one that does, the panel keeps its code box (7e).
    {
      const e = fresh('capped');
      for (let i = 0; i < 5; i++) await issue(w, e);
      const used = lastCode();
      for (let i = 0; i < 5; i++) await verify(w, e, wrong(used, i), '192.0.2.50');
      cache.clear();   // and a minute after the fifth
      const p = panel();
      const mailed = mail.length;
      await p.send(e);
      ok('at the cap, Send falls back to the link sender', p.calls.join(',') === '/api/signin-code 429,/api/send-signin-link 200', p.calls);
      ok('and that email really has no code in it', mail.length === mailed + 1 && lastCode() === null, [mail.length - mailed, lastCode()]);
      const first = p.seen();
      ok('so the panel asks for no code: it says codes are paused, and to use the link', !asksForCode(first) && /paused for about/.test(first.text) && /Tap the link in that email/.test(first.text), first);
      p.calls.length = 0;
      await p.resend();   // the 30s countdown is over, the worker's 60s cooldown is still armed
      ok('Resend inside the minute mails nothing new', mail.length === mailed + 1 && p.calls.join(',') === '/api/signin-code 429,/api/send-signin-link 200', [mail.length - mailed, p.calls]);
      const again = p.seen();
      ok('and the panel still asks for no code: nothing says to type six digits', !asksForCode(again), again);
      ok('it says to use the link in the email she already has', /Tap the link in that email/.test(again.text), again.text);
      ok('in plain words, with no em-dash', !/—/.test(again.text), again.text);
    }

    // 7a2. The same cap in the installed iPhone app: a link cannot sign THIS app in, so never say so.
    {
      const e = fresh('cappedapp');
      for (let i = 0; i < 5; i++) await issue(w, e);
      const used = lastCode();
      for (let i = 0; i < 5; i++) await verify(w, e, wrong(used, i), '192.0.2.51');
      cache.clear();
      const p = panel({ inApp: true });
      await p.send(e);
      const s1 = p.seen();
      ok('in the installed iPhone app the capped panel says codes are paused', !asksForCode(s1) && /paused for about/.test(s1.text), s1);
      ok('and that the link opens Cubby in Safari, not this app', /in Safari/.test(s1.text) && !/Tap the link in that email/.test(s1.text) && !/Open the link in it on this device/.test(s1.text), s1.text);
    }

    // 7a3. The right code refused by the hourly ceiling: a pause, said honestly, never "try again".
    {
      const e = fresh('verifycap');
      cache.clear();
      const p = panel();
      await p.send(e);
      ok('a fresh address gets the code box', p.seen().codeBox, p.seen());
      const c = lastCode();
      for (let i = 0; i < 4; i++) await verify(w, e, wrong(c, i));
      await issue(w, e); const c2 = lastCode();
      for (let i = 0; i < 3; i++) await verify(w, e, wrong(c2, i));
      await p.submitCode(c2);
      const s3 = p.seen();
      ok('her right code past the ceiling says codes are paused, and for how long', /codes are paused for about/.test(s3.text) && /Nothing is wrong with your account/.test(s3.text), s3.text);
      ok('and does not tell her to keep trying now', !/Mind trying again/.test(s3.text), s3.text);
      ok('in plain words, with no em-dash', !/—/.test(s3.text), s3.text);
    }

    // 7b. The companion: the cooldown reply after a send that DID carry a code still offers the box.
    {
      const e = fresh('cooled');
      cache.clear();
      const p = panel();
      await p.send(e);
      ok('a normal Send shows the code box', p.seen().codeBox, p.seen());
      p.calls.length = 0;
      await p.resend();
      const s = p.seen();
      ok('a Resend inside the minute keeps the code box, because that email has a code', s.codeBox && /6-digit code/.test(s.text), s);
      ok('and says it was the email from a minute ago', /already sent an email/.test(s.text) && p.calls.join(',') === '/api/signin-code 200', [s.text, p.calls]);
    }

    // 7c. A code email that went out without its link (Identity Toolkit was down): a Resend inside
    // the minute must not point her at a link that email does not have.
    {
      const e = fresh('nolink');
      cache.clear();
      oobDown = true;
      const p = panel();
      await p.send(e);
      oobDown = false;
      ok('with the link minter down, the code still goes out and the panel offers no link', p.seen().codeBox && !/tap the link/.test(p.seen().text), p.seen());
      await p.resend();
      const s = p.seen();
      ok('a Resend inside the minute keeps the code box and still mentions no link', s.codeBox && !/tap the link/.test(s.text), s);
    }

    // 7d. A cooldown VALUE in the oldest shape (just '1'): the old answer stands. Since 16 Nov 2026 the key is a
    // keyed hash of the address (cooldownRequest), so it is seeded under the key this worker reads; an entry an
    // older worker left under the plaintext key is never read, and lapses within its minute.
    {
      const e = fresh('legacy');
      cache.clear();
      cache.set((await mod.__signin.cooldownRequest(SA, 'link', e)).url, '1');
      const r = await post(w, '/api/send-signin-link', { email: e });
      const body = await r.json();
      ok('a cooldown value in the oldest shape (\'1\') still answers cached, as it always did', r.status === 200 && body.ok === true && body.cached === true, body);
    }
  }

  /* 7e. signin-2. The issue ceiling with her newest code STILL LIVE: the panel must not send her to a
     link (in the installed app a link cannot sign her in), and must say the code she has still works. */
  console.log('\n7e. at the issue ceiling, with the code in her newest email still live');
  {
    const e = fresh('cappedlive');
    for (let i = 0; i < 5; i++) await issue(w, e);
    const live = lastCode();
    const sixth = await issue(w, e);
    ok('the sixth ask is refused, saying her newest code is live and for how long', sixth.status === 429 && sixth.body.liveCode === true && sixth.body.liveFor > 500 && sixth.body.liveFor <= 600 && sixth.body.retryAfter > 60, sixth);
    for (const inApp of [false, true]) {
      const where = inApp ? 'in the installed iPhone app' : 'in a browser';
      cache.clear();
      const p = panel({ inApp });
      const mailed = mail.length;
      await p.send(e);
      const s = p.seen();
      ok(where + ': Send asks no link sender, and mails nothing', p.calls.join(',') === '/api/signin-code 429' && mail.length === mailed, [p.calls, mail.length - mailed]);
      ok(where + ': the code box stays open', s.codeBox, s);
      ok(where + ': it says new codes are paused but the code in her most recent email still works, and to type it here',
        /^New codes are paused for (about an hour|about \d+ minutes|a minute or so), but the code in your most recent email still works for about \d+ more minutes\. Type it here\./.test(s.text), s.text);
      ok(where + ': and never points her at a link', !/link/i.test(s.text), s.text);
      ok(where + ': in plain words, with no em-dash', !/\u2014/.test(s.text), s.text);
      if (inApp) {
        await p.submitCode(live);
        ok('typing that code there signs her in', p.calls.includes('signed-in'), p.calls);
      }
    }
  }

  /* 7f. signin-7. A verify 429 with no retryAfter is the per-IP limiter counting THIS DEVICE, not the
     hourly ceiling on the address, so it must not say codes for this email are paused. */
  console.log('\n7f. a pause from the per-device limiter says so in device words');
  {
    let limitVerify = false;
    const env = Object.assign({}, ENV, { SIGNIN_RATE_LIMITER: { async limit(o) { return { success: !(limitVerify && /^code:/.test(o.key)) }; } } });
    const e = fresh('device');
    cache.clear();
    const p = panel({ env });
    await p.send(e);
    const c = lastCode();
    limitVerify = true;
    await p.submitCode(c);
    const s = p.seen();
    ok('the limiter really answered: a 429 with no retryAfter', p.calls.includes('/api/signin-verify 429'), p.calls);
    ok('the panel says it was a lot of tries in a minute, and to type the code again', /^That was a lot of tries in a minute\. Wait a moment, then type your code again\.$/.test(s.text), s.text);
    ok('and never that codes for this email are paused', !/for this email/.test(s.text) && !/paused/.test(s.text), s.text);
    limitVerify = false;
    await p.submitCode(c);
    ok('a moment later the same code signs her in', p.calls.includes('signed-in'), p.calls);
  }

  console.log('\n8. one address cannot arm the cooldown of another');
  {
    /* The link sender's key for "code-<x>" used to be the code sender's key for "<x>", so a stranger
       who asked for a link to code-alice@... silenced alice's code email for a minute, again and again. */
    const e = fresh('victim');
    cache.clear();
    const decoy = await post(w, '/api/send-signin-link', { email: 'code-' + e });
    ok('the stranger\'s link request to the look-alike address goes through', decoy.status === 200, decoy.status);
    const mailed = mail.length;
    const r = await post(w, '/api/signin-code', { email: e });
    const body = await r.json().catch(() => ({}));
    ok('her own code request right after is not answered from his cooldown', r.status === 200 && body.cached !== true && body.hasCode === true, body);
    ok('and her code email really goes out', mail.length === mailed + 1, mail.length - mailed);
  }

  /* 9. signin-1. The cooldown is keyed on the normalised address (no +tags, no Gmail dots), the code on
     the exact one. A stranger asking for jane+k1@ armed jane@'s cooldown, and every one of her own
     requests in that minute was answered "cached": no code for her address, ever, for as long as he
     kept asking. The cache is NOT cleared inside this section, so everything here is one minute. */
  console.log('\n9. a stranger asking for a variant of her address every minute cannot keep her out');
  {
    const ATT = '203.0.113.5', HER = '198.51.100.20';
    const jane = fresh('jane'), [local, domain] = jane.split('@');
    cache.clear();
    let hisOk = 0, hers = 0, cachedForHer = 0, signedInHer = 0;
    for (let k = 1; k <= 6; k++) {
      const a = await post(w, '/api/signin-code', { email: local + '+k' + k + '@' + domain }, ATT);
      if (a.status === 200) hisOk++;
      const mailed = mail.length;
      const r = await post(w, '/api/signin-code', { email: jane }, HER);
      const b = await r.json().catch(() => ({}));
      if (b.cached) cachedForHer++;
      if (r.status === 200 && b.hasCode === true && !b.cached && mail.length === mailed + 1 && mail[mail.length - 1].to === jane) hers++;
      if (signedIn(await verify(w, jane, lastCode(), HER))) signedInHer++;
    }
    ok('his six variant requests go through', hisOk === 6, hisOk);
    ok('every one of her own requests in the same minute mints and mails HER a code', hers === 6 && cachedForHer === 0, { hers, cachedForHer });
    ok('and every one of those codes signs her in', signedInHer === 6, signedInHer);

    const g = 'jane' + process.pid + 'x' + (++serial) + '@gmail.com';
    await post(w, '/api/signin-code', { email: g.slice(0, 1) + '.' + g.slice(1) }, ATT);
    const gr = await post(w, '/api/signin-code', { email: g }, HER);
    const gb = await gr.json().catch(() => ({}));
    ok('the same with a Gmail dot variant', gr.status === 200 && gb.hasCode === true && !gb.cached, gb);
    ok('and that code signs her in', signedIn(await verify(w, g, lastCode(), HER)));

    const lv = fresh('janelink'), [ll, ld] = lv.split('@');
    await post(w, '/api/send-signin-link', { email: ll + '+k1@' + ld }, ATT);
    const lmailed = mail.length;
    const lr = await post(w, '/api/send-signin-link', { email: lv }, HER);
    const lb = await lr.json().catch(() => ({}));
    ok('and on the link sender: his variant does not silence her email', lr.status === 200 && !lb.cached && mail.length === lmailed + 1 && mail[mail.length - 1].to === lv, [lb, mail.length - lmailed]);

    // Companions: the cooldown still does its job for the exact address that armed it.
    const mailed = mail.length;
    const again = await post(w, '/api/signin-code', { email: g }, HER);
    const ab = await again.json().catch(() => ({}));
    ok('a repeat of her OWN address inside the minute is still answered from her cooldown, and mails nothing', ab.cached === true && mail.length === mailed, [ab, mail.length - mailed]);
    const old = fresh('oldcool');
    const ckey = (await mod.__signin.cooldownRequest(SA, 'code', old)).url;   // the hashed key (16 Nov 2026)
    for (const legacy of ['1', JSON.stringify({ hasCode: true, hasLink: true })]) {
      cache.set(ckey, legacy);
      const r = await post(w, '/api/signin-code', { email: old }, HER);
      const b = await r.json().catch(() => ({}));
      ok('a cooldown value in an older shape (' + (legacy === '1' ? "'1'" : 'no address hash') + ') still gives its old answer', b.cached === true && mail.length === mailed, b);
    }
    const leftOver = JSON.stringify([...cache.values()]);
    ok('no cooldown value holds an address in plain text', !/@/.test(leftOver), leftOver.slice(0, 200));
  }

  /* 10. signin-3. One dual-stack home connection is two networks (its IPv4 and its IPv6 /48). He waits
     for her to ask, then burns each code she is sent, from each half of his connection in turn. */
  console.log('\n10. a stranger on one dual-stack connection cannot keep her out');
  {
    const e = fresh('dual');
    const V4 = '203.0.113.9', V6 = '2001:db8:99::1', HER = '198.51.100.20';
    evaluated = 0;
    await issue(w, e, HER); const c1 = lastCode();
    for (let i = 0; i < 5; i++) await verify(w, e, wrong(c1, i), V4);
    ok('his IPv4 burns her first code', (await verify(w, e, c1, HER)).status === 400);
    await issue(w, e, HER); const c2 = lastCode();
    for (let i = 0; i < 5; i++) await verify(w, e, wrong(c2, i), V6);
    ok('his IPv6 burns her second', (await verify(w, e, c2, HER)).status === 400);
    const third = await issue(w, e, HER);
    ok('she is still sent a third code', third.status === 200 && third.body.hasCode === true, third);
    const c3 = lastCode();
    const his = [];
    for (let i = 0; i < 4; i++) his.push((await verify(w, e, wrong(c3, i), i % 2 ? V4 : V6)).status);
    ok('both halves of his connection are now out of guesses, and none was compared', his.every((s) => s === 429) && evaluated === 10, [his, evaluated]);
    ok('she makes a typo', (await verify(w, e, wrong(c3, 9), HER)).status === 400);
    const v = await verify(w, e, c3, HER);
    ok('and her right code still signs her in', signedIn(v), [v.status, v.body]);
  }

  /* 11. signin-8. The network tag is keyed per document, so two addresses asked for from the same
     networks share no tag, while inside one document a network keeps one tag (what the ceilings count). */
  console.log('\n11. the same networks leave unrelated tags in two people\'s documents');
  {
    const alice = fresh('alice'), bob = fresh('bob');
    const nets = ['203.0.113.77', '2001:db8:abcd:12::99', '::ffff:198.51.100.88'];
    for (const ip of nets) { await issue(w, alice, ip); await issue(w, bob, ip); }
    const af = await codeFields(alice), bf = await codeFields(bob);
    ok('the document ids derived here are the worker\'s (both documents exist)', !!af && !!bf, [!!af, !!bf]);
    const at = tagsIn(af), bt = tagsIn(bf);
    ok('each document holds one tag per network', new Set(at).size === 3 && new Set(bt).size === 3, [at, bt]);
    ok('and alice and bob share none of them', !at.some((t) => bt.includes(t)), [at, bt]);
    await issue(w, alice, nets[0]);
    const at2 = tagsIn(await codeFields(alice));
    ok('the companion: inside one document the same network repeats its tag', at2.length === 4 && at2.filter((t) => t === at[0]).length === 2, at2);
  }

  /* 12. signin-4. The canary's address is public (it is in this repo), so the public endpoints refuse
     every .invalid address; and a canary that does find itself capped says so. */
  console.log('\n12. nobody else can ask for the canary\'s address, and a capped canary says it is capped');
  {
    const mailed = mail.length;
    for (const [route, body] of [['/api/signin-code', {}], ['/api/send-signin-link', {}], ['/api/signin-verify', { code: '123456' }]]) {
      for (const addr of ['canary@cubby.invalid', 'someone@example.invalid']) {
        cache.clear();
        const r = await post(w, route, Object.assign({ email: addr }, body), '192.0.2.91');
        const b = await r.json().catch(() => ({}));
        ok(route + ' refuses ' + addr + ' like any malformed address', r.status === 400 && b.error === 'invalid_email', [r.status, b]);
      }
    }
    ok('and nothing was mailed', mail.length === mailed, mail.length - mailed);
    ok('nor any code document written for it', (await codeFields('canary@cubby.invalid')) === null);
    cache.clear();
    const fine = await post(w, '/api/signin-code', { email: fresh('invalidish').replace('@', '@invalid.') }, '192.0.2.91');
    ok('the companion: an ordinary address that only contains "invalid" is fine', fine.status === 200, fine.status);
    // Cap the canary's own document directly (twelve codes this hour), as nothing public can now.
    const now = Date.now();
    const seed = await realFetch(DOCS + '/signinCodes/' + docIdFor('canary@cubby.invalid'), {
      method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { issues: { arrayValue: { values: Array.from({ length: 12 }, (_, i) => ({ stringValue: (now - 1000 * (i + 1)) + ':zzzzzzzzzzzz' })) } } } })
    });
    ok('the canary\'s document is seeded at its ceiling', seed.ok, seed.status);
    const v = await mod.signinCanary(ENV);
    ok('the canary reports a capped run as capped', v.ok === false && /^capped/.test(String(v.reason)), v.reason);
    ok('and never as a refused Firestore write', !/refused/.test(String(v.reason)), v.reason);
    const next = await mod.signinCanary(ENV);
    ok('the next run is green again', next.ok === true, next.reason);
  }

  /* 13. signin-5. A document minted by the production build carries her plaintext address. The first
     spend now masks it out. */
  console.log('\n13. a production-era code document loses its plaintext address on the first spend');
  {
    const e = fresh('prodera');
    const ip = '192.0.2.77';
    await issue(w, e, ip); const c = lastCode();
    const add = await realFetch(DOCS + '/signinCodes/' + docIdFor(e) + '?updateMask.fieldPaths=email', {
      method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { email: { stringValue: e } } })
    });
    const before = await codeFields(e);
    ok('the production-era shape is staged: the document holds her address', add.ok && before && before.email && before.email.stringValue === e, before && Object.keys(before));
    await verify(w, e, wrong(c, 0), ip);
    const after = await codeFields(e);
    ok('one miss later the address is gone', !!after && !after.email && !!after.mac, after && Object.keys(after));
    ok('and her code still signs her in', signedIn(await verify(w, e, c, ip)));
  }

  console.log('\nFirestore write statuses:', JSON.stringify(writes));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  done();
})().catch((e) => { console.error(e); fail++; done(); });
