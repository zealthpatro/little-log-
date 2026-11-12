/* The sign-in code's guess budget, under concurrency and across reissues, against the REAL worker.
 *
 * WHY THIS EXISTS (security audit, findings server-1, identity-signin-code-attempt-race, server-2).
 * A correct six-digit code returns a custom token for whatever account holds that address, so the
 * number of guesses anyone gets is the whole security of the code. Three holes made it far more than 5:
 *   1. verify read `tries`, then wrote tries-1 with no precondition, so 50 requests in flight all read
 *      the same count and all got their guess compared;
 *   2. every reissue replaced the document with tries=5, so "5 per code" had no ceiling per address;
 *   3. every per-IP limiter keyed on the full IPv6 address, and one subscriber holds a whole /64.
 *
 * WHY THE FIRESTORE HERE IS HONEST. It keeps an updateTime per document and enforces
 * currentDocument.updateTime / currentDocument.exists exactly as the REST API does (a mismatch is a
 * refused write), applies updateMask as a merge where masked-but-absent fields are deleted, and adds
 * network latency so concurrent requests really do interleave. "Evaluated" is counted at the HMAC
 * compare itself, not inferred from a status code: every wrong guess answers 400 either way.
 * It accepts writes both as documents:commit (the shape the worker sends now) and as per-document
 * PATCH/DELETE (the shape it sent before), so it still grades the older worker honestly. Which write
 * shapes REAL Firestore accepts is not something a stub can say: test/signin-code-emulator.test.js
 * asks the emulator.
 * DETERMINISTIC. The latency comes from a fixed-seed generator, and the double-tap case does not
 * hope for the dangerous interleaving, it forces it: the first burn is held until the second spend
 * has landed. Round 1 of this file left both to Math.random and went red in 2 runs of 31.
 *
 *   node test/signin-code-budget.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };

const HOST = 'https://little-cubby.com';
const EMAIL = 'mum@example.com';

const { privateKey } = nodeCrypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SA = { project_id: 'little-log-a9caa', client_email: 'cubby@little-log-a9caa.iam.gserviceaccount.com', private_key: privateKey };
const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), RESEND_API_KEY: 're_test_key' };

// ---- the world outside our code -----------------------------------------------------------------
/* world.users: address -> { uid, verified, providers }. verified undefined is an account whose lookup
   carries no emailVerified at all, which is how a JSON API answers for false. world.updates records
   every accounts:update body, so section 9 can read exactly what the worker asked for. */
const world = { docs: new Map(), users: new Map(), updates: [], mail: [], clock: 0, spends: 0, refused: 0 };
const cacheStore = new Map();
function resetWorld() { world.docs.clear(); world.users.clear(); world.updates.length = 0; world.failUpdate = false; world.mail.length = 0; world.spends = 0; world.refused = 0; world.holdBurns = 0; world.invalidSpend = false; world.raceIssues = 0; cacheStore.clear(); }
globalThis.caches = { default: {
  async match(req) { const v = cacheStore.get(String(req.url)); return v === undefined ? undefined : new Response(v); },
  async put(req, res) { cacheStore.set(String(req.url), await res.text()); },
} };

/* Count every HMAC compare: that is a guess being evaluated, whatever the response says. */
let evaluated = 0;
const subtle = globalThis.crypto.subtle;
const realVerify = subtle.verify.bind(subtle);
subtle.verify = function (alg) {
  if (((alg && alg.name) || alg) === 'HMAC') evaluated++;
  return realVerify.apply(null, arguments);
};

const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
let seed = 0x5eed;   // mulberry32: the same interleavings every run
function rand() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const latency = () => new Promise((r) => setTimeout(r, Math.floor(rand() * 4)));
/* world.holdBurns: a delete waits until this many spends have landed (with a bound, so a worker that
   never makes a second spend cannot hang the test). */
async function heldBurn() {
  for (let i = 0; world.holdBurns && world.spends < world.holdBurns && i < 500; i++) await new Promise((r) => setTimeout(r, 1));
}
function stamp() { world.clock++; return new Date(Date.UTC(2026, 10, 12, 3, 0, 0) + world.clock).toISOString().replace('Z', String(world.clock % 1000).padStart(3, '0') + 'Z'); }

globalThis.fetch = async function (input, init) {
  const url = String(input && input.url ? input.url : input);
  const method = ((init && init.method) || 'GET').toUpperCase();
  const body = (init && init.body) || null;

  if (url.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 'ya29.test', expires_in: 3600 });
  if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode')) {
    return J({ oobLink: 'https://little-log-a9caa.firebaseapp.com/__/auth/action?mode=signIn&oobCode=OOB&apiKey=k' });
  }
  if (/accounts:lookup$/.test(url)) {
    const e = (JSON.parse(body || '{}').email || [])[0];
    const u = world.users.get(e);
    if (!u) return J({});
    const rec = { localId: u.uid, email: e };
    if (typeof u.verified === 'boolean') rec.emailVerified = u.verified;   // undefined: the field is absent
    if (u.providers) rec.providerUserInfo = u.providers.map((p) => ({ providerId: p }));
    return J({ users: [rec] });
  }
  if (/accounts:update$/.test(url) && method === 'POST') {
    const b = JSON.parse(body || '{}');
    world.updates.push(b);
    if (world.failUpdate) return J({ error: { code: 500, message: 'INTERNAL' } }, 500);
    for (const u of world.users.values()) if (u.uid === b.localId) {
      if (b.emailVerified === true) u.verified = true;
      /* deleteAttribute PASSWORD removes the password and keeps the email. deleteProvider would unlink
         email sign-in and clear the email too (the real Auth emulator does; signin-claim-auth-emu gates
         it), so this stub records an email wipe for it rather than pretending it is harmless. */
      if (u.providers && Array.isArray(b.deleteAttribute) && b.deleteAttribute.indexOf('PASSWORD') > -1) u.providers = u.providers.filter((p) => p !== 'password');
      if (Array.isArray(b.deleteProvider) && b.deleteProvider.indexOf('password') > -1) { u.providers = (u.providers || []).filter((p) => p !== 'password'); u.emailWiped = true; }
    }
    return J({ localId: b.localId });
  }
  if (/\/accounts$/.test(url) && method === 'POST') {
    const b = JSON.parse(body || '{}'); const uid = 'uid_' + (world.users.size + 1); world.users.set(b.email, { uid, verified: b.emailVerified === true }); return J({ localId: uid });
  }

  /* documents:commit, one write per call, preconditions in the JSON body. Same semantics as below. */
  if (/\/documents:commit$/.test(url) && method === 'POST') {
    await latency();
    const wr = (JSON.parse(body || '{}').writes || [])[0] || {};
    const name = wr.update ? wr.update.name : wr.delete;
    const mm = /\/documents\/signinCodes\/([^/]+)$/.exec(String(name || ''));
    if (!mm) return J({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad document name' } }, 400);
    const id = mm[1];
    if (wr.delete) await heldBurn();
    /* world.raceIssues: a reissue (a whole-document replace) loses its race to a spend that lands in
       between its read and its write, this many times. The spend moves the version, so the replace's
       precondition is refused exactly as Firestore would refuse it. */
    if (!wr.delete && !wr.updateMask && world.raceIssues > 0 && world.docs.get(id)) {
      world.raceIssues--;
      world.docs.get(id).updateTime = stamp();
    }
    const cur = world.docs.get(id);
    const pre = wr.currentDocument || {};
    const refuse = () => { world.refused++; return J({ error: { code: 400, status: 'FAILED_PRECONDITION', message: 'precondition failed' } }, 400); };
    if (pre.updateTime !== undefined && (!cur || cur.updateTime !== pre.updateTime)) return refuse();
    if (pre.exists === false && cur) { world.refused++; return J({ error: { code: 409, status: 'ALREADY_EXISTS' } }, 409); }
    if (pre.exists === true && !cur) return J({ error: { code: 404, status: 'NOT_FOUND' } }, 404);
    if (wr.delete) { world.docs.delete(id); const t = stamp(); return J({ writeResults: [{}], commitTime: t }); }
    const incoming = wr.update.fields || {};
    const mask = (wr.updateMask && wr.updateMask.fieldPaths) || [];
    let fields;
    if (mask.length) {
      fields = Object.assign({}, cur ? cur.fields : {});
      for (const k of mask) { if (k in incoming) fields[k] = incoming[k]; else delete fields[k]; }
    } else fields = incoming;
    if (mask.indexOf('tries') > -1 && world.invalidSpend) return J({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad write' } }, 400);
    if (mask.indexOf('tries') > -1) world.spends++;
    const doc = { name: 'documents/signinCodes/' + id, fields, updateTime: stamp() };
    world.docs.set(id, doc);
    return J({ writeResults: [{ updateTime: doc.updateTime }], commitTime: doc.updateTime });
  }

  const m = url.match(/\/documents\/signinCodes\/([^?]+)(?:\?(.*))?$/);
  if (m) {
    await latency();   // the request is in flight; others can read meanwhile
    const id = m[1];
    const q = new URLSearchParams(m[2] || '');
    const cur = world.docs.get(id);
    // Preconditions, checked and applied in one step, the way Firestore commits a write.
    const wantTime = q.get('currentDocument.updateTime');
    const wantExists = q.get('currentDocument.exists');
    const refuse = () => { world.refused++; return J({ error: { code: 400, status: 'FAILED_PRECONDITION', message: 'precondition failed' } }, 400); };
    if (method === 'PATCH' || method === 'DELETE') {
      if (wantTime !== null && (!cur || cur.updateTime !== wantTime)) return refuse();
      if (wantExists === 'false' && cur) return refuse();
      if (wantExists === 'true' && !cur) return J({ error: { status: 'NOT_FOUND' } }, 404);
    }
    if (method === 'PATCH') {
      const incoming = JSON.parse(body || '{}').fields || {};
      const mask = q.getAll('updateMask.fieldPaths');
      let fields;
      if (mask.length) {
        fields = Object.assign({}, cur ? cur.fields : {});
        for (const k of mask) { if (k in incoming) fields[k] = incoming[k]; else delete fields[k]; }
      } else fields = incoming;
      if (mask.indexOf('tries') > -1) world.spends++;
      const doc = { name: 'documents/signinCodes/' + id, fields, updateTime: stamp() };
      world.docs.set(id, doc);
      return J(doc);
    }
    if (method === 'DELETE') { await heldBurn(); world.docs.delete(id); return J({}); }
    return cur ? J(cur) : J({ error: { status: 'NOT_FOUND' } }, 404);
  }

  if (url === 'https://api.resend.com/emails') { world.mail.push(JSON.parse(body || '{}')); return J({ id: 'm' + world.mail.length }); }
  throw new Error('unstubbed external call: ' + method + ' ' + url);
};

const post = (worker, p, payload, env, headers) => worker.fetch(
  new Request(HOST + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', Origin: HOST }, headers || {}), body: JSON.stringify(payload) }),
  env || ENV, { waitUntil() {}, passThroughOnException() {} });
const codeFromEmail = (html) => { const m = String(html).match(/>(\d{6})</g); return m ? m[m.length - 1].replace(/\D/g, '') : null; };
const lastCode = () => codeFromEmail(world.mail[world.mail.length - 1].html);
const wrongFor = (c, k) => String((Number(c) + 1 + (k || 0)) % 1000000).padStart(6, '0');
async function issue(worker) { cacheStore.clear(); const r = await post(worker, '/api/signin-code', { email: EMAIL }); return { status: r.status, body: await r.json().catch(() => ({})) }; }
const verify = (worker, code) => post(worker, '/api/signin-verify', { email: EMAIL, code });
const liveMacs = () => [...world.docs.values()].filter((d) => d.fields && d.fields.mac).length;

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-budget-'));
  for (const im of src.matchAll(/^import\s[^;]*?from\s+['"](\.\/[^'"]+)['"]/gm)) {
    const to = path.join(tmpdir, im[1]); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(__dirname, '..', im[1]), to);
  }
  fs.writeFileSync(path.join(tmpdir, 'worker.mjs'), src);
  const worker = (await import(pathToFileURL(path.join(tmpdir, 'worker.mjs')).href)).default;

  console.log('\n1. fifty wrong guesses at once, then the right one');
  {
    resetWorld();
    await issue(worker);
    const good = lastCode();
    evaluated = 0;
    const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => verify(worker, wrongFor(good, i))));
    const evalStorm = evaluated;
    ok('no request in the storm signed anyone in', rs.every((r) => r.status !== 200), rs.map((r) => r.status));
    ok('at most 5 of the 50 guesses were ever compared', evalStorm <= 5, evalStorm);
    ok('and no more than 5 tries were spent', world.spends <= 5, world.spends);
    const after = await verify(worker, good);
    ok('the right code afterwards is refused: the code is dead', after.status === 400, after.status);
    ok('and it was refused without being compared', evaluated === evalStorm, evaluated - evalStorm);
    ok('no live code is left to guess against', liveMacs() === 0, liveMacs());
  }

  /* The ceilings are split by network as well as per address (final review 2026-11-12): with one
     ceiling per address, anyone who knew a parent's email could spend it from one laptop and lock her
     out of code sign-in for an hour. A network is CF-Connecting-IP (IPv4, or the IPv6 /48). */
  const NET = (n) => ({ 'CF-Connecting-IP': '203.0.113.' + n });
  async function issueFrom(n) { cacheStore.clear(); const r = await post(worker, '/api/signin-code', { email: EMAIL }, ENV, NET(n)); return { status: r.status, body: await r.json().catch(() => ({})) }; }
  const verifyFrom = (n, code) => post(worker, '/api/signin-verify', { email: EMAIL, code }, ENV, NET(n));

  console.log('\n2. reissuing does not hand out a fresh guess budget (one network)');
  {
    resetWorld();
    evaluated = 0;
    await issueFrom(1); let c = lastCode();
    for (let i = 0; i < 3; i++) await verifyFrom(1, wrongFor(c, i));
    const second = await issueFrom(1);
    ok('a second code can be sent after 3 misses', second.status === 200 && second.body.hasCode === true, second);
    c = lastCode();
    for (let i = 0; i < 2; i++) await verifyFrom(1, wrongFor(c, i));
    ok('five guesses compared across two codes', evaluated === 5, evaluated);
    const right = await verifyFrom(1, c);
    ok('the right code, as that network\'s 6th guess this hour, does not sign in', right.status !== 200, right.status);
    const rb = await right.json();
    ok('it gets the try-later answer, with how long to wait', right.status === 429 && rb.error === 'rate_limited' && rb.retryAfter > 60 && rb.retryAfter <= 3600, rb);
    ok('and the 6th guess was never compared', evaluated === 5, evaluated);
    const mailed = world.mail.length;
    const third = await issueFrom(1);
    ok('no further code is minted for that network this hour', third.status === 429 && world.mail.length === mailed, [third, world.mail.length - mailed]);
    ok('and it says how long codes are paused for', third.body.error === 'rate_limited' && third.body.retryAfter > 60, third.body);
    ok('at a GUESS ceiling it never says a code is still live: this network could not use one', third.body.liveCode !== true, third.body);
    cacheStore.clear();
    const link = await post(worker, '/api/send-signin-link', { email: EMAIL }, ENV, NET(1));
    const lb = await link.json();
    ok('but the link email still goes out from there', link.status === 200 && lb.hasLink === true, lb);
    ok('and it honestly carries no code', lb.hasCode === false && !codeFromEmail(world.mail[world.mail.length - 1].html), lb);
    /* THE LOCKOUT, closed: those seven misses came from someone else's laptop. Her phone is on its
       own network, still has its own share, and her code signs her in. */
    const hers = await issueFrom(2);
    ok('her phone, on another network, still gets a code', hers.status === 200 && hers.body.hasCode === true, hers);
    ok('and that code signs her in', (await verifyFrom(2, lastCode())).status === 200);
  }

  console.log('\n2a. THE LOCKOUT: a stranger with her address and one laptop cannot spend her way in');
  {
    resetWorld();
    evaluated = 0;
    /* What the final review did to the old worker: ask for codes and burn guesses from one network
       until refused. That used to spend the whole address, and her own code was then refused too. */
    let refused = 0;
    for (let round = 0; round < 4 && refused < 2; round++) {
      const got = await issueFrom(9);
      if (got.status !== 200) { refused++; continue; }
      const c = lastCode();
      for (let i = 0; i < 5; i++) { const r = await verifyFrom(9, wrongFor(c, i)); if (r.status === 429) { refused++; break; } }
    }
    ok('the stranger is refused before he has spent the address', evaluated < 15 && refused > 0, { evaluated, refused });
    const hers = await issueFrom(2);
    ok('she asks from her phone and a code arrives', hers.status === 200 && hers.body.hasCode === true, hers);
    const v = await verifyFrom(2, lastCode());
    ok('and her code signs her in', v.status === 200, v.status);
  }

  console.log('\n2b. the per-address total still bounds guessing from many networks');
  {
    resetWorld();
    evaluated = 0;
    for (const n of [1, 2]) {
      await issueFrom(n); const c = lastCode();
      for (let i = 0; i < 5; i++) await verifyFrom(n, wrongFor(c, i));
    }
    ok('two networks at their share: ten guesses compared', evaluated === 10, evaluated);
    await issueFrom(3); let c3 = lastCode();
    for (let i = 0; i < 4; i++) await verifyFrom(3, wrongFor(c3, i));
    ok('a third network spends four more', evaluated === 14, evaluated);
    const fifth = await issueFrom(5);
    ok('a fifth network can still be sent a code, with one guess left on the address', fifth.status === 200, fifth);
    const lastGo = lastCode();
    await verifyFrom(5, wrongFor(lastGo, 0));
    ok('and spends the fifteenth', evaluated === 15, evaluated);
    const d = await issueFrom(4);
    ok('a fourth network gets no code: the address has had its guesses', d.status === 429 && d.body.retryAfter > 0, d);
    ok('and is not told a code is live (a guess ceiling)', d.body.liveCode !== true, d.body);
    const r = await verifyFrom(4, '000000');
    ok('a guess from a fourth network is refused without a compare', r.status === 429 && evaluated === 15, [r.status, evaluated]);
    const r5 = await verifyFrom(5, lastGo);
    ok('and even the right code, from a network with share left, is not compared past the address total', r5.status === 429 && evaluated === 15, [r5.status, evaluated]);
  }

  console.log('\n3. codes minted per address per hour: five per network, twelve in all');
  {
    resetWorld();
    const a = [];
    let sixth = null;
    for (let i = 0; i < 6; i++) { const r = await issueFrom(1); a.push(r.status); if (i === 5) sixth = r.body; }
    ok('one network: five sends mint five codes', a.slice(0, 5).every((s) => s === 200) && world.mail.length === 5, [a, world.mail.length]);
    ok('the sixth from there mints none and mails nothing', a[5] === 429 && world.mail.length === 5, [a, world.mail.length]);
    /* signin-2: at an ISSUE ceiling her newest code still works, so the answer says so, and for how
       long, and the app keeps its code box open instead of sending her to a link. */
    ok('and it says the code in her newest email is still live, and for how long', sixth && sixth.liveCode === true && sixth.liveFor > 500 && sixth.liveFor <= 600 && sixth.retryAfter > 60, sixth);
    ok('the fifth code still works', (await verifyFrom(1, lastCode())).status === 200);
    // The companions: at the same ceiling with no live code, liveCode is never claimed.
    resetWorld();
    for (let i = 0; i < 5; i++) await issueFrom(1);
    const dead = lastCode();
    for (let i = 0; i < 5; i++) await verifyFrom(7, wrongFor(dead, i));   // another network kills it
    const afterKill = await issueFrom(1);
    ok('at the issue ceiling with her code used up, a 429 that claims no live code', afterKill.status === 429 && afterKill.body.liveCode !== true, afterKill);
    resetWorld();
    for (let i = 0; i < 5; i++) await issueFrom(1);
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60 * 1000;   // past the code's ten minutes, inside the hour
    let expired;
    try { expired = await issueFrom(1); } finally { Date.now = realNow; }
    ok('and with her code expired, none either', expired.status === 429 && expired.body.liveCode !== true, expired);
    resetWorld();
    const all = [];
    for (const n of [1, 2, 3]) for (let i = 0; i < 4; i++) all.push((await issueFrom(n)).status);   // under five each, so the total binds
    ok('three networks mint twelve between them', all.every((s) => s === 200) && world.mail.length === 12, [all, world.mail.length]);
    const thirteenth = await issueFrom(4);
    ok('the thirteenth, from a fourth network, mints none', thirteenth.status === 429 && world.mail.length === 12, [thirteenth.status, world.mail.length]);
    ok('the twelfth code still works', (await verifyFrom(3, lastCode())).status === 200);
  }

  console.log('\n4. the issue endpoint still says nothing about whether an account exists');
  {
    resetWorld();
    world.users.set('known@example.com', { uid: 'uid_known', verified: true });
    cacheStore.clear();
    const a = await post(worker, '/api/signin-code', { email: 'known@example.com' });
    const b = await post(worker, '/api/signin-code', { email: 'nobody@example.com' });
    ok('same status and same body for a known and an unknown address', a.status === b.status && JSON.stringify(await a.json()) === JSON.stringify(await b.json()));
  }

  console.log('\n5. a real parent never notices any of this');
  {
    for (let k = 1; k <= 5; k++) {
      resetWorld();
      await issue(worker); const c = lastCode();
      for (let i = 0; i < k - 1; i++) await verify(worker, wrongFor(c, i));
      const r = await verify(worker, c);
      ok('the right code on try ' + k + ' signs her in', r.status === 200 && !!(await r.json()).token, r.status);
      ok('and it is single use', (await verify(worker, c)).status === 400);
    }
    resetWorld();
    await issue(worker); const first = lastCode();
    for (let i = 0; i < 3; i++) await verify(worker, wrongFor(first, i));
    await issue(worker); const second = lastCode();
    ok('after a resend the old code is dead', (await verify(worker, first)).status === 400);
    ok('and the new one still works after four misses in all, a stale code among them', (await verify(worker, second)).status === 200);
    await issue(worker);
    ok('signing in again the same hour works: success clears the slate', (await verify(worker, lastCode())).status === 200);

    /* The interleaving that signed her in twice, forced every time: both taps pay and match, and the
       first one's burn only lands after the second one's spend. */
    resetWorld();
    await issue(worker); const dbl = lastCode();
    world.holdBurns = 2;
    const both = await Promise.all([verify(worker, dbl), verify(worker, dbl)]);
    ok('the race really happened: both taps spent a try', world.spends === 2, world.spends);
    ok('a double-tapped submit still signs her in once', both.filter((r) => r.status === 200).length === 1, both.map((r) => r.status));
    ok('and the other tap is a plain bad_code, not an error', both.filter((r) => r.status === 400).length === 1, both.map((r) => r.status));
  }

  console.log('\n5b. a write Firestore rejects as malformed is a failure, never a wrong code');
  {
    /* A refused precondition means "somebody wrote first, re-read". A malformed write means our write
       shape is wrong, and treating that as a race is how round 1 would have answered every correct
       code with "did not match" in silence. */
    resetWorld();
    await issue(worker); const c = lastCode();
    world.invalidSpend = true;
    evaluated = 0;
    const r = await verify(worker, c);
    ok('the right code against a write Firestore calls malformed answers 500, not bad_code', r.status === 500, r.status);
    ok('and nothing was compared', evaluated === 0, evaluated);
  }

  console.log('\n6. per-IP limits key an IPv6 client on its /64');
  {
    const routes = [
      ['POST', '/api/signin-code', { email: EMAIL }],
      ['POST', '/api/signin-verify', { email: EMAIL, code: '123456' }],
      ['POST', '/api/send-signin-link', { email: EMAIL }],
      ['GET', '/api/invite-peek?t=abcdefghijklmnop1234', null],
      ['POST', '/api/send-invite', { email: EMAIL, token: 'abcdefghijklmnop1234' }],
      ['POST', '/api/newsletter', { email: EMAIL }],
      ['POST', '/api/step', { event: 'x' }],
      ['POST', '/api/dose', { n: 'x' }],
      ['POST', '/api/game/create', {}],
      ['POST', '/api/game/abcd1234/guess', {}],
    ];
    const keyFor = async (method, p, payload, ip) => {
      const keys = [];
      const lim = { async limit(o) { keys.push(o.key); return { success: false }; } };
      const env = Object.assign({}, ENV, { SIGNIN_RATE_LIMITER: lim, STEP_RATE_LIMITER: lim, GAMES_DB: {} });
      const init = { method, headers: { 'content-type': 'application/json', Origin: HOST, 'CF-Connecting-IP': ip } };
      if (payload) init.body = JSON.stringify(payload);
      const r = await worker.fetch(new Request(HOST + p, init), env, { waitUntil() {}, passThroughOnException() {} });
      return { status: r.status, key: keys[0] };
    };
    for (const [method, p, payload] of routes) {
      const a = await keyFor(method, p, payload, '2001:db8:1:2:aaaa::1');
      const b = await keyFor(method, p, payload, '2001:0DB8:0001:0002:bbbb:cccc:dddd:eeee');
      const c = await keyFor(method, p, payload, '2001:db8:1:3::1');
      ok(p + ': two addresses in one /64 share a bucket', a.status === 429 && !!a.key && a.key === b.key, [a, b]);
      ok(p + ': a different /64 gets its own', !!c.key && c.key !== a.key, [a.key, c.key]);
    }
    const v4 = await keyFor('POST', '/api/signin-code', { email: EMAIL }, '203.0.113.7');
    const v4b = await keyFor('POST', '/api/signin-code', { email: EMAIL }, '203.0.113.8');
    ok('IPv4 is still keyed per address', v4.key !== v4b.key && /203\.0\.113\.7$/.test(v4.key), [v4.key, v4b.key]);
    const mapped = await keyFor('POST', '/api/signin-code', { email: EMAIL }, '::ffff:203.0.113.7');
    ok('an IPv4-mapped address counts as that IPv4 address', mapped.key === v4.key, [mapped.key, v4.key]);
    ok('no limiter reads CF-Connecting-IP on its own any more', (src.match(/headers\.get\(['"]cf-connecting-ip['"]\)/gi) || []).length === 1);
  }

  console.log('\n7. clientIpKey expands compressed zeros right, and can bucket at /48');
  {
    const mod = await import(pathToFileURL(path.join(tmpdir, 'worker.mjs')).href);
    const key = (mod.__signin && mod.__signin.clientIpKey) || null;
    ok('clientIpKey is exported for this test', typeof key === 'function');
    const k = (ip, g) => { const r = new Request(HOST, { headers: ip ? { 'CF-Connecting-IP': ip } : {} }); return key ? (g === undefined ? key(r) : key(r, g)) : null; };
    const cases = [
      ['2001:0:0:5::1', undefined, '2001:0:0:5::/64'],
      ['2001::5:a:b:c:d', undefined, '2001:0:0:5::/64'],
      ['2001:0:0:5:ffff:1:2:3', undefined, '2001:0:0:5::/64'],
      ['2001:db8::', undefined, '2001:db8:0:0::/64'],
      ['::1', undefined, '0:0:0:0::/64'],
      ['2001:db8:1:2:aaaa::1', 4, '2001:db8:1:2::/64'],
      ['2001:0:0:5::1', 3, '2001:0:0::/48'],
      ['2001::5:a:b:c:d', 3, '2001:0:0::/48'],
      ['2001:db8:1:2:aaaa::1', 3, '2001:db8:1::/48'],
      ['2001:DB8:0001:ffff::9', 3, '2001:db8:1::/48'],
      ['2001:db8::1', 3, '2001:db8:0::/48'],
      ['203.0.113.7', 3, '203.0.113.7'],
      ['::ffff:203.0.113.7', 3, '203.0.113.7'],
      ['1:2:3:4::5:6:7:8', undefined, '1:2:3:4::5:6:7:8'],   // '::' standing for no group is not an address
      ['', undefined, 'unknown'],
    ];
    for (const [ip, g, want] of cases) ok('clientIpKey(' + (ip || "''") + (g === undefined ? '' : ', ' + g) + ') is ' + want, k(ip, g) === want, k(ip, g));
    ok('2001:0:0:5::1 and 2001::5:a:b:c:d share a /64', k('2001:0:0:5::1') === k('2001::5:a:b:c:d'));
    ok('but 2001:0:0:6::1 is a different /64', k('2001:0:0:6::1') !== k('2001:0:0:5::1'), k('2001:0:0:6::1'));
    ok('and at /48 it is the same bucket again', k('2001:0:0:6::1', 3) === k('2001:0:0:5::1', 3), k('2001:0:0:6::1', 3));
  }

  /* signin-9. A reissue is a conditional replace, and every spend that lands between its read and its
     write refuses it. Two goes turned a few concurrent spends into 502 store_failed, and her code
     request fell back to a link. It now re-reads up to SIGNIN_CODE_TRIES + 1 times, as the spend does. */
  console.log('\n8. a code request survives spends landing in between its read and its write');
  {
    resetWorld();
    await issue(worker);
    world.raceIssues = 3;
    const r = await issue(worker);
    ok('three spends land in between, and she still gets a code', r.status === 200 && r.body.hasCode === true, r);
    ok('the races really happened (all three refused a write)', world.raceIssues === 0, world.raceIssues);
    ok('and the code she got works', (await verify(worker, lastCode())).status === 200);
    resetWorld();
    await issue(worker);
    world.raceIssues = 6;
    const r6 = await issue(worker);
    ok('the retry is bounded: six refusals in a row still end in store_failed, not a loop', r6.status === 502 && r6.body.error === 'store_failed', r6);
  }

  /* NP-1, the Worker half. A code proves the inbox, so it must land in an account the inbox owns. An
     account somebody pre-registered with her address and a password (emailVerified false) is claimed
     for her first: verified, its password removed, every earlier session revoked. */
  console.log('\n9. an unverified account for her address is claimed for her before she gets its session');
  {
    const uidOf = (tok) => JSON.parse(Buffer.from(String(tok).split('.')[1], 'base64url').toString()).uid;
    const logs = [];
    const realErr = console.error;
    const signIn = async () => {
      await issue(worker);
      console.error = (...a) => logs.push(a.join(' '));
      try { const r = await verify(worker, lastCode()); return { status: r.status, body: await r.json().catch(() => ({})) }; }
      finally { console.error = realErr; }
    };
    for (const shape of ['absent', 'false']) {
      resetWorld(); logs.length = 0;
      world.users.set(EMAIL, { uid: 'uid_squatter', verified: shape === 'false' ? false : undefined, providers: ['password'] });
      const t0 = Math.floor(Date.now() / 1000);
      const v = await signIn();
      ok('emailVerified ' + shape + ': she signs in to the account that holds her address', v.status === 200 && uidOf(v.body.token) === 'uid_squatter', v);
      const u = world.updates[0] || {};
      ok('emailVerified ' + shape + ': one accounts:update, made before the session', world.updates.length === 1 && u.localId === 'uid_squatter', world.updates);
      ok('emailVerified ' + shape + ': marking it verified, removing the password, revoking earlier sessions',
        u.emailVerified === true && Array.isArray(u.deleteAttribute) && u.deleteAttribute.indexOf('PASSWORD') > -1
          && Math.abs(Number(u.validSince) - t0) <= 5, u);
      ok('emailVerified ' + shape + ': the password is really gone', world.users.get(EMAIL).providers.length === 0, world.users.get(EMAIL));
      ok('emailVerified ' + shape + ': and the claim never unlinks email sign-in, which would erase her address', !('deleteProvider' in u) && !world.users.get(EMAIL).emailWiped, u);
      ok('emailVerified ' + shape + ': and it is logged', logs.some((l) => /signin_unverified_account_claimed/.test(l) && /uid_squatter/.test(l)), logs);
    }
    resetWorld(); logs.length = 0;
    world.users.set(EMAIL, { uid: 'uid_real', verified: true, providers: ['google.com'] });
    const mine = await signIn();
    ok('a verified account signs in as before', mine.status === 200 && uidOf(mine.body.token) === 'uid_real', mine);
    ok('and is never touched: no accounts:update', world.updates.length === 0, world.updates);
    resetWorld(); logs.length = 0;
    world.users.set(EMAIL, { uid: 'uid_squatter', providers: ['password'] });
    world.failUpdate = true;
    const refused = await signIn();
    ok('if the claim is refused, no session is minted into that account', refused.status === 500 && !refused.body.token, refused);
  }

  try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SIGNIN-CODE-BUDGET: FAIL' : 'SIGNIN-CODE-BUDGET: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
