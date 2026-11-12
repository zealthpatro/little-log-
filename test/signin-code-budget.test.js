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
const world = { docs: new Map(), users: new Map(), mail: [], clock: 0, spends: 0, refused: 0 };
const cacheStore = new Map();
function resetWorld() { world.docs.clear(); world.users.clear(); world.mail.length = 0; world.spends = 0; world.refused = 0; cacheStore.clear(); }
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
const latency = () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 4)));
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
    return world.users.has(e) ? J({ users: [{ localId: world.users.get(e) }] }) : J({});
  }
  if (/\/accounts$/.test(url) && method === 'POST') {
    const b = JSON.parse(body || '{}'); const uid = 'uid_' + (world.users.size + 1); world.users.set(b.email, uid); return J({ localId: uid });
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
    if (method === 'DELETE') { world.docs.delete(id); return J({}); }
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

  console.log('\n2. reissuing does not hand out a fresh guess budget');
  {
    resetWorld();
    evaluated = 0;
    await issue(worker); let c = lastCode();
    for (let i = 0; i < 3; i++) await verify(worker, wrongFor(c, i));
    await issue(worker); c = lastCode();
    for (let i = 0; i < 5; i++) await verify(worker, wrongFor(c, i));
    const third = await issue(worker);
    ok('a third code can still be sent (8 misses so far this hour)', third.status === 200 && third.body.hasCode === true, third);
    c = lastCode();
    for (let i = 0; i < 2; i++) await verify(worker, wrongFor(c, i));
    ok('ten guesses compared across three codes', evaluated === 10, evaluated);
    const right = await verify(worker, c);
    ok('the right code, on the 11th guess in an hour, is refused like a wrong one', right.status === 400, right.status);
    ok('with exactly the wrong-code answer', right.status === 400 && (await right.json()).error === 'bad_code');
    ok('and the 11th guess was never compared', evaluated === 10, evaluated);
    const mailed = world.mail.length;
    const fourth = await issue(worker);
    ok('no further code is minted for that address this hour', fourth.status !== 200 && world.mail.length === mailed, [fourth, world.mail.length - mailed]);
    cacheStore.clear();
    const link = await post(worker, '/api/send-signin-link', { email: EMAIL });
    const lb = await link.json();
    ok('but the link email still goes out, so a real parent still has a way in', link.status === 200 && lb.hasLink === true, lb);
    ok('and it honestly carries no code', lb.hasCode === false && !codeFromEmail(world.mail[world.mail.length - 1].html), lb);
  }

  console.log('\n3. at most five codes are minted per address per hour');
  {
    resetWorld();
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await issue(worker)).status);
    ok('five sends mint five codes', statuses.slice(0, 5).every((s) => s === 200) && world.mail.length === 5, [statuses, world.mail.length]);
    ok('the sixth mints none and mails nothing', statuses[5] !== 200 && world.mail.length === 5, [statuses, world.mail.length]);
    ok('the fifth code still works', (await verify(worker, lastCode())).status === 200);
  }

  console.log('\n4. the issue endpoint still says nothing about whether an account exists');
  {
    resetWorld();
    world.users.set('known@example.com', 'uid_known');
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
    for (let i = 0; i < 4; i++) await verify(worker, wrongFor(first, i));
    await issue(worker); const second = lastCode();
    ok('after a resend the old code is dead', (await verify(worker, first)).status === 400);
    for (let i = 0; i < 3; i++) await verify(worker, wrongFor(second, i));
    ok('and the new one still works after nine misses in all', (await verify(worker, second)).status === 200);
    await issue(worker);
    ok('signing in again the same hour works: success clears the slate', (await verify(worker, lastCode())).status === 200);

    resetWorld();
    await issue(worker); const dbl = lastCode();
    const both = await Promise.all([verify(worker, dbl), verify(worker, dbl)]);
    ok('a double-tapped submit still signs her in once', both.filter((r) => r.status === 200).length === 1, both.map((r) => r.status));
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

  try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SIGNIN-CODE-BUDGET: FAIL' : 'SIGNIN-CODE-BUDGET: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
