#!/usr/bin/env node
/* Throw seeded malformed requests at every route the REAL worker.js serves, and judge each answer.
 *
 *   node tools/fuzz_worker.js [--seed=N] [--seconds=300] [--out=DIR]
 *   node tools/fuzz_worker.js --replay=FILE           one saved request, in a fresh isolate, judged again
 *   node tools/fuzz_worker.js --self-test [--seconds=20]
 *        plants three known bugs in a temp copy of worker.js (a throw on bad JSON, an unescaped
 *        reflection into text/html, a limiter whose "no" is ignored) and fails unless all three are
 *        found; then fuzzes the real worker.js for the same time box and reports what it finds.
 *
 * Invariants, per request:
 *   I1 never throws out of the fetch handler (nor out of a ctx.waitUntil promise)
 *   I2 never answers 5xx except a declared path: server_config, db_error or store_failed always; the
 *      upstream codes (unavailable, send_failed, write_failed, failed) only when this request was
 *      handed an injected upstream failure. A 5xx "failed" with healthy stubs is an exception caught
 *      inside a route, which means bad input reached code that cannot handle it.
 *   I3 never reflects request input into HTML unescaped: every fuzzed string carries a <fz-N> marker,
 *      and it must not appear raw in a non-JSON response, nor in the html of any email it sends
 *   I4 rate limiters still bound: once a limiter has said no inside a request, that request answers 429
 *      (whatever else it would have said: a "no" ignored on a request that fails anyway is still a bypass
 *      for the one that would not). The page-view limiter is exempt: it bounds the counter, not the page.
 *
 * The world outside is stubbed exactly as test/worker-routes.test.js does: D1 is real SQLite
 * (node:sqlite), Firestore/Google/Resend are in-process stand-ins, and nothing leaves this process.
 * Same seed, same requests. A report goes to --out (default os.tmpdir()) as fuzz-worker-<seed>.json/.md,
 * and every finding carries a one-line repro command.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const arg = (k, d) => { const a = ARGS.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const SELF = ARGS.includes('--self-test');
const SEED = Number(arg('seed', SELF ? 4242 : Date.now() % 1e9));
const SECONDS = Number(arg('seconds', SELF ? 20 : 300));
const OUT = arg('out', os.tmpdir());

/* ---------- a seeded PRNG ---------- */
function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (n) => Math.floor(r() * n);
  r.pick = (xs) => xs[r.int(xs.length)];
  r.chance = (p) => r() < p;
  return r;
}

/* ---------- the stubbed world (test/worker-routes.test.js's, made total) ---------- */
const HOST = 'https://little-cubby.com';
const PROJECT = 'little-log-a9caa';
const FS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const SA = { project_id: PROJECT, client_email: 'cubby@' + PROJECT + '.iam.gserviceaccount.com',
  private_key: nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey };
const idPair = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = Object.assign(idPair.publicKey.export({ format: 'jwk' }), { kid: 'fz-kid', alg: 'RS256', use: 'sig' });
const b64u = (s) => Buffer.from(s).toString('base64url');
function idToken(uid, email) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'fz-kid', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ aud: PROJECT, iss: 'https://securetoken.google.com/' + PROJECT, sub: uid, iat: now - 5, exp: now + 3600, email, email_verified: true }));
  return head + '.' + body + '.' + nodeCrypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), idPair.privateKey).toString('base64url');
}
function makeD1(fail) {
  const db = new DatabaseSync(':memory:');
  const prepare = (sql) => {
    let args = [];
    const go = (fn) => { if (fail.d1) throw new Error('D1_ERROR: injected'); return fn(); };
    const norm = (a) => a.map((x) => (x === undefined ? null : (typeof x === 'object' && x !== null ? JSON.stringify(x) : x)));
    const st = {
      bind: (...a) => { args = norm(a); return st; },
      run: async () => go(() => { db.prepare(sql).run(...args); return { success: true, meta: { changes: 1 } }; }),
      first: async (col) => go(() => { const r = db.prepare(sql).get(...args); return r ? (col ? r[col] : Object.assign({}, r)) : null; }),
      all: async () => go(() => ({ results: db.prepare(sql).all(...args).map((r) => Object.assign({}, r)) })),
      raw: async () => go(() => db.prepare(sql).all(...args).map((r) => Object.values(r))),
    };
    return st;
  };
  return { prepare, batch: async (sts) => { const out = []; for (const s of sts) out.push(await s.run()); return out; }, exec: async (s) => { db.exec(s); return {}; } };
}
const world = { docs: new Map(), mail: [], fail: { fs: false, resend: false, d1: false, google: false }, unstubbed: [] };
const J = (o, s, h) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'content-type': 'application/json' }, h || {}) });
const cacheStore = new Map();
globalThis.caches = { default: {
  /* Status and headers kept, as the real Cache API keeps them: a cached 503 must come back a 503. */
  async match(r) { const v = cacheStore.get(String(r.url)); return v === undefined ? undefined : new Response(v.body, { status: v.status, headers: v.headers }); },
  async put(r, res) { cacheStore.set(String(r.url), { status: res.status, headers: [...res.headers], body: await res.text() }); },
} };
globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
  if (url.startsWith('https://oauth2.googleapis.com/token')) return world.fail.google ? J({ error: 'x' }, 500) : J({ access_token: 'tok', expires_in: 3600 });
  if (url.startsWith('https://www.googleapis.com/service_accounts/v1/jwk/')) return J({ keys: [JWK] }, 200, { 'cache-control': 'max-age=3600' });
  if (url === 'https://api.resend.com/emails') {
    if (world.fail.resend) return J({ error: 'x' }, 500);
    world.mail.push(JSON.parse(init.body)); return J({ id: 'm' + world.mail.length });
  }
  if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
    if (world.fail.google) return J({ error: { message: 'x' } }, 500);
    if (/accounts:lookup/.test(url)) return J({ users: [] });
    if (/accounts:sendOobCode/.test(url)) return J({ email: 'x@example.test', oobLink: HOST + '/__/auth/action?oobCode=fz' });
    return J({ localId: 'fzuid' + world.mail.length, idToken: 't' });
  }
  if (url.startsWith('https://fcm.googleapis.com/')) return J({ name: 'm' });
  if (url.startsWith('https://little-log-a9caa.firebaseapp.com/')) return new Response('<p>auth handler</p>', { status: 200, headers: { 'content-type': 'text/html' } });
  if (url.startsWith('https://firestore.googleapis.com/v1/')) {
    if (world.fail.fs) return J({ error: { status: 'UNAVAILABLE' } }, 503);
    if (/:runQuery/.test(url)) return J([{}]);
    if (/:commit/.test(url)) return J({ writeResults: [{}], commitTime: new Date().toISOString() });
    const p = decodeURIComponent(url.replace(FS + '/', '').split('?')[0]);
    if (method === 'GET') return world.docs.has(p) ? J({ name: FS + '/' + p, fields: world.docs.get(p), updateTime: new Date().toISOString() }) : J({ error: { status: 'NOT_FOUND' } }, 404);
    if (method === 'DELETE') { world.docs.delete(p); return J({}); }
    let body = {}; try { body = JSON.parse(init.body || '{}'); } catch (e) {}
    if (method === 'POST' && /documentId=/.test(url)) return J({ name: FS + '/' + p, fields: body.fields || {} });
    world.docs.set(p, body.fields || {});
    return J({ name: FS + '/' + p, fields: body.fields || {} });
  }
  world.unstubbed.push(method + ' ' + url.slice(0, 120));
  return new Response('not stubbed', { status: 404 });
};

/* ---------- the requests ---------- */
const ROUTES = [
  ['GET', '/api/invite-peek'], ['POST', '/api/send-invite'], ['POST', '/api/step'], ['GET', '/api/canary'],
  ['POST', '/api/signin-code'], ['POST', '/api/signin-verify'], ['POST', '/api/send-signin-link'], ['POST', '/api/newsletter'],
  ['POST', '/api/signin-status'],
  ['POST', '/api/dose'], ['GET', '/api/health'], ['POST', '/api/account/purge'],
  ['POST', '/api/game/create'], ['GET', '/api/game/abcd1234'], ['POST', '/api/game/abcd1234/guess'], ['POST', '/api/game/abcd1234/reveal'],
  ['POST', '/api/hub/create'], ['GET', '/api/hub/abcd1234'], ['POST', '/api/hub/abcd1234/game'], ['POST', '/api/hub/abcd1234/guess'],
  ['GET', '/.well-known/apple-app-site-association'], ['GET', '/g/abcd1234'], ['GET', '/__/auth/action'], ['GET', '/'], ['GET', '/app/'],
  ['GET', '/no/such/page'],
];
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'];
const ORIGINS = [HOST, HOST, HOST, undefined, 'null', 'https://evil.example', 'https://little-cubby.com.evil.example', 'http://localhost:8080', 'https://LITTLE-CUBBY.COM', '%%%', 'https://little-cubby.com:444'];
const IPS = ['203.0.113.7', '2001:db8:1:2::9', '2001:db8:1:2:3:4:5:6', '::ffff:198.51.100.4', '', 'not-an-ip', 'fe80::1%en0', '1.2.3.4, 5.6.7.8', '::', ':::::::::'];
let markerN = 0;
const marker = () => '<fz-' + (++markerN) + ' onerror=x>"\'&';
function oddString(r) {
  const opts = [
    () => '', () => ' ', () => marker(), () => 'a'.repeat(r.pick([41, 65, 513, 5000, 70000])) + marker(),
    () => 'x@example.test', () => 'X@Example.Test' + marker(), () => 'a@b', () => '@', () => 'mail@' + 'x'.repeat(300) + '.test',
    () => '\u0000‮😀\ud800' + marker(), () => '../../etc/passwd', () => '%00%2e%2e%2f', () => '__proto__', () => 'constructor',
    () => String(r.int(1e6)).padStart(6, '0'), () => 'tok' + 'A'.repeat(r.pick([10, 16, 32, 64, 65])), () => idToken('u' + r.int(5), 'u@example.test'),
    () => 'eyJ.' + marker() + '.sig', () => '<script>alert(1)</script>', () => 'javascript:alert(1)',
  ];
  return r.pick(opts)();
}
function oddValue(r, depth) {
  const k = r.int(10);
  if (k < 4) return oddString(r);
  if (k === 4) return r.pick([0, -1, 1e308, NaN, Infinity, 3.5, 2 ** 53 + 1]);
  if (k === 5) return r.pick([true, false, null]);
  if (k === 6 && depth < 4) return Array.from({ length: r.int(4) }, () => oddValue(r, depth + 1));
  if (k === 7 && depth < 4) return oddBody(r, depth + 1);
  /* A value that String() cannot convert: its toString (and valueOf) are not functions. */
  if (k === 8 && r.chance(0.5)) return r.pick([{ toString: 1 }, { toString: 'x', valueOf: 'y' }, [{ toString: 1 }], { valueOf: {} , toString: [] }]);
  return oddString(r);
}
/* toString and valueOf as keys make nested objects that String(), `+ ''` and template literals cannot
   convert ({"code":{"toString":1}} threw out of /api/signin-verify after the .trim() sites were fixed). */
const FIELDS = ['idToken', 'token', 'email', 'code', 'n', 'event', 'props', 'name', 'nickname', 'guess', 'note', 'title', 'hostKey',
  'key', 'result', 'consent', 'source', 'redirect', 'continueUrl', 't', '__proto__', 'constructor', 'familyName', 'toString', 'valueOf', 'ref'];
function oddBody(r, depth) {
  const o = {};
  const n = r.int(6);
  for (let i = 0; i < n; i++) o[r.pick(FIELDS)] = oddValue(r, depth || 0);
  return o;
}
const enc = (s) => encodeURIComponent(typeof s.toWellFormed === 'function' ? s.toWellFormed() : s.replace(/[\ud800-\udfff]/g, '\ufffd'));
function makeRequest(r) {
  let [method, p] = r.pick(ROUTES);
  if (r.chance(0.15)) method = r.pick(METHODS);
  if (r.chance(0.1)) p = p + r.pick(['/', '//', '/x', '/' + enc(marker()), '/%2e%2e/%2e%2e', '/' + 'a'.repeat(3000), '/é中']);
  let q = '';
  if (r.chance(0.5)) q = '?' + r.pick(['t', 'code', 'go', 'x', 'e']) + '=' + enc(oddString(r)) + (r.chance(0.3) ? '&t=' + enc(oddString(r)) : '');
  const headers = {};
  const origin = r.pick(ORIGINS);
  if (origin !== undefined) headers.Origin = origin;
  if (r.chance(0.2)) headers.Referer = r.pick([HOST + '/app/', 'https://evil.example/', marker()]);
  headers['CF-Connecting-IP'] = r.pick(IPS);
  if (r.chance(0.8)) headers['content-type'] = r.pick(['application/json', 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']);
  if (r.chance(0.05)) headers['content-length'] = r.pick(['0', '-1', '99999999', 'abc']);
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    const k = r.int(10);
    if (k === 0) body = undefined;
    else if (k === 1) body = '';
    else if (k === 2) body = '{"unterminated": ';
    else if (k === 3) body = JSON.stringify(oddValue(r, 0));
    else if (k === 4) body = '{"x":"' + 'y'.repeat(r.pick([600, 100000, 1100000])) + '"}';
    else if (k === 5) body = '[' + '['.repeat(2000) + ']'.repeat(2000) + ']';
    else body = JSON.stringify(oddBody(r, 0));
  }
  const fail = { fs: r.chance(0.06), resend: r.chance(0.06), d1: r.chance(0.06), google: r.chance(0.04) };
  return { method, path: p + q, headers, body, fail };
}

/* ---------- running one request against one isolate, and judging it ---------- */
const DECLARED_ALWAYS = new Set(['server_config', 'db_error', 'store_failed']);
/* GET /api/canary is a dead man's switch: a 503 with one of these codes IS its answer when the sign-in
   canary has never run, gone stale or is failing (worker.js canaryStatus), never a crash. */
const DECLARED_CANARY = new Set(['never_run', 'stale', 'failing', 'unavailable']);
const DECLARED_UPSTREAM = new Set(['unavailable', 'send_failed', 'write_failed', 'failed']);
function makeEnv(state) {
  const limiter = (name) => ({
    async limit({ key }) {
      const k = name + '|' + key;
      const n = (state.counts.get(k) || 0) + 1; state.counts.set(k, n);
      const success = n <= 3;
      state.cur.limits.push({ name, key, success });
      return { success };
    },
  });
  const failD1 = world.fail;
  return {
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), RESEND_API_KEY: 're_test', MAIL_FROM: 'Cubby <hello@example.test>',
    GAMES_DB: state.games || (state.games = makeD1(failD1)), NEWSLETTER_DB: state.news || (state.news = makeD1(failD1)),
    SIGNIN_RATE_LIMITER: limiter('signin'), DOSE_RATE_LIMITER: limiter('dose'), GAMES_RATE_LIMITER: limiter('games'),
    NEWSLETTER_RATE_LIMITER: limiter('newsletter'), PAGE_RATE_LIMITER: limiter('page'), STEP_RATE_LIMITER: limiter('step'),
    SEND_INVITE_DAILY_CAP: '50', GAMES_DAILY_CAP: '200', PAGE_STATS_DAILY_CAP: '200', STEP_STATS_DAILY_CAP: '200',
    ASSETS: { fetch: async (req) => {
      const u = new URL(req.url);
      if (u.pathname === '/no/such/page' || /\/x$/.test(u.pathname)) return new Response('<h1>Not found</h1>', { status: 404, headers: { 'content-type': 'text/html' } });
      return new Response('<!doctype html><title>Cubby</title>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    } },
  };
}
async function runOne(worker, state, req) {
  state.cur = { limits: [], waits: [] };
  world.fail = req.fail;
  world.mail.length = 0;              // only this request's mail is judged; keeping it all leaked memory
  const mailBefore = 0;
  const init = { method: req.method, headers: req.headers };
  if (req.body !== undefined && req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body;
  const ctx = { waitUntil(p) { state.cur.waits.push(Promise.resolve(p).then(() => null, (e) => String((e && e.stack) || e))); }, passThroughOnException() {} };
  let res = null, threw = null, text = '';
  try {
    const request = new Request(HOST + req.path, init);
    res = await worker.fetch(request, state.env, ctx);
    text = res && res.body ? await res.text() : '';
  } catch (e) {
    threw = String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ');
    if (/^TypeError: (Request|Failed to parse URL|Invalid URL)|Request with (GET|HEAD) method cannot have body/.test(threw) && !res) return null; // the runtime refused to BUILD it: not the Worker's
  }
  const waitErrs = (await Promise.all(state.cur.waits)).filter(Boolean);
  world.fail = { fs: false, resend: false, d1: false, google: false };
  const out = [];
  const status = res ? res.status : 0;
  if (threw) out.push({ inv: 'I1', sig: 'throws ' + threw.split(' | ')[0].replace(/\s+at\s.*$/, '').slice(0, 90), detail: threw });
  waitErrs.forEach((w) => out.push({ inv: 'I1', sig: 'waitUntil rejects', detail: w.split('\n')[0] }));
  if (status >= 500) {
    let code = null, body = null; try { body = JSON.parse(text); code = body.error || null; } catch (e) {}
    const injected = req.fail.fs || req.fail.resend || req.fail.d1 || req.fail.google;
    const canary = status === 503 && /^\/api\/canary(\?|$)/.test(req.path) && body && body.ok === false && DECLARED_CANARY.has(body.code);
    if (!canary && !(DECLARED_ALWAYS.has(code) || (injected && DECLARED_UPSTREAM.has(code))))
      out.push({ inv: 'I2', sig: status + ' ' + (code || (body && body.code) || (body ? 'json without a code' : 'non-json')), detail: text.slice(0, 160) });
  }
  const ct = (res && res.headers.get('content-type')) || '';
  if (res && !/application\/json/i.test(ct) && /<fz-\d+/.test(text)) out.push({ inv: 'I3', sig: 'reflected into ' + (ct || 'no content-type'), detail: (text.match(/.{0,40}<fz-\d+.{0,20}/) || [''])[0] });
  for (const m of world.mail.slice(mailBefore)) if (/<fz-\d+/.test(String(m.html || ''))) out.push({ inv: 'I3', sig: 'reflected into email html', detail: (String(m.html).match(/.{0,40}<fz-\d+.{0,20}/) || [''])[0] });
  /* The page limiter bounds the page-view COUNTER (ctx.waitUntil), never the page itself, so its "no"
     is not this invariant's business; test/page-stats.test.js owns it. */
  if (state.cur.limits.some((l) => !l.success && l.name !== 'page') && status !== 429) out.push({ inv: 'I4', sig: 'limiter said no, answered ' + status, detail: JSON.stringify(state.cur.limits.filter((l) => !l.success)) });
  return { status, findings: out };
}

/* A stable name for where a request went, so the same bug found twice is one finding with one id. */
function routeOf(p) {
  const pathOnly = p.split('?')[0];
  const known = ROUTES.map((x) => x[1]).filter((r) => r !== '/' && (pathOnly === r || pathOnly.startsWith(r + '/'))).sort((a, b) => b.length - a.length)[0];
  if (known) return known + (pathOnly === known ? '' : '/*');
  return pathOnly === '/' ? '/' : '/' + (pathOnly.split('/')[1] || '').slice(0, 20) + '/*';
}

async function loadWorker(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-fuzz-worker-'));
  for (const im of src.matchAll(/^import\s[^;]*?from\s+['"](\.\/[^'"]+)['"]/gm)) {
    const to = path.join(dir, im[1]); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(ROOT, im[1]), to);
  }
  fs.writeFileSync(path.join(dir, 'worker.mjs'), src);
  let iso = 0;
  return async () => (await import(pathToFileURL(path.join(dir, 'worker.mjs')).href + '?isolate=' + (++iso))).default;
}

function seedWorld() {
  const str = (x) => ({ stringValue: x });
  world.docs.set('households/H1', { members: { mapValue: { fields: { u0: str('owner'), u1: str('caregiver') } } },
    app: { mapValue: { fields: { settings: { mapValue: { fields: { householdName: str('The <fz-0> family') } } } } } } });
  world.docs.set('inviteLinks/tokAAAAAAAAAAAAAAAA', { householdId: str('H1'), expiresAt: { timestampValue: new Date(Date.now() + 864e5).toISOString() },
    invitedByName: str('<fz-0 name>'), fromEmail: str('u0@example.test') });
}

async function fuzz(src, seed, seconds, label) {
  const isolate = await loadWorker(src);
  const r = rng(seed);
  seedWorld();
  const findings = new Map();
  let worker = await isolate(), state = { counts: new Map() }; state.env = makeEnv(state);
  const t0 = Date.now(); let n = 0, refused = 0;
  /* Every 250 requests the world is reset (limiter counts, D1, the stubbed Firestore, the cache), the way a
     fresh isolate would see it. The MODULE is re-imported far less often: an ES module is never garbage
     collected, so a fresh import every 250 requests ran a 5-minute box out of heap (1.8 GB at 100 s on
     2026-11-13). Module-level caches inside worker.js therefore live for 20,000 requests, as they would
     in a long-lived Cloudflare isolate. */
  const RESET_EVERY = 250, REIMPORT_EVERY = 20000;
  const statuses = {};
  const quiet = console.error, qlog = console.log, qwarn = console.warn;
  console.error = () => {}; console.warn = () => {};
  try {
    while (Date.now() - t0 < seconds * 1000) {
      if (n % RESET_EVERY === 0 && n) {
        if (n % REIMPORT_EVERY === 0) worker = await isolate();
        state = { counts: new Map() }; state.env = makeEnv(state);
        world.docs.clear(); cacheStore.clear(); seedWorld();
        if (world.unstubbed.length > 200) world.unstubbed = [...new Set(world.unstubbed)].slice(0, 50);
      }
      const req = makeRequest(r);
      n++;
      const v = await runOne(worker, state, req);
      if (!v) { refused++; continue; }
      statuses[v.status] = (statuses[v.status] || 0) + 1;
      for (const f of v.findings) {
        const route = req.method + ' ' + routeOf(req.path);
        const key = f.inv + '|' + route + '|' + f.sig;
        if (!findings.has(key)) findings.set(key, Object.assign({ route, count: 0, firstAt: n, request: req }, f));
        findings.get(key).count++;
      }
    }
  } finally { console.error = quiet; console.log = qlog; console.warn = qwarn; }
  return { label, seed, seconds, requests: n, refusedByRuntime: refused, statuses, findings: [...findings.values()], unstubbed: [...new Set(world.unstubbed)].slice(0, 20) };
}

function report(res, outDir, srcLabel) {
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, 'fuzz-worker-' + res.seed);
  res.findings.forEach((f, i) => {
    f.id = 'FW-' + f.inv + '-' + nodeCrypto.createHash('sha1').update(f.inv + f.route + f.sig).digest('hex').slice(0, 6);
    const rp = base + '-' + f.id + '.request.json';
    fs.writeFileSync(rp, JSON.stringify(f.request, null, 1));
    f.repro = 'node tools/fuzz_worker.js --replay=' + rp;
  });
  fs.writeFileSync(base + '.json', JSON.stringify(res, null, 1));
  const md = ['# Worker fuzz, seed ' + res.seed + ' (' + srcLabel + ')', '',
    res.requests + ' requests in ' + res.seconds + ' s; statuses ' + JSON.stringify(res.statuses) + '; ' + res.refusedByRuntime + ' refused by the runtime before reaching the Worker.', '',
    res.findings.length ? '| id | invariant | route | what | count | repro |\n|---|---|---|---|---|---|\n' + res.findings.map((f) =>
      '| ' + f.id + ' | ' + f.inv + ' | `' + f.route + '` | ' + String(f.sig).replace(/\|/g, '/') + ': ' + String(f.detail).slice(0, 90).replace(/\|/g, '/').replace(/\n/g, ' ') + ' | ' + f.count + ' | `' + f.repro + '` |').join('\n') : 'No invariant broken.', ''];
  fs.writeFileSync(base + '.md', md.join('\n'));
  return base;
}

async function replay(file) {
  const req = JSON.parse(fs.readFileSync(file, 'utf8'));
  const isolate = await loadWorker(fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8'));
  seedWorld();
  const state = { counts: new Map() }; state.env = makeEnv(state);
  const v = await runOne(await isolate(), state, req);
  console.log(JSON.stringify({ request: { method: req.method, path: req.path.slice(0, 200) }, verdict: v }, null, 1));
  process.exit(v && v.findings.length ? 1 : 0);
}

/* The planted bugs. Each replacement must match exactly once, so if worker.js moves, this says so. */
const PLANTS = [
  { name: 'a throw on bad JSON in /api/purge', inv: 'I1',
    from: "  let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, 400); }\n  let auth; try { auth = await verifyFirebaseToken((body && body.idToken) || ''); }",
    to: "  let body = JSON.parse(await request.text());\n  let auth; try { auth = await verifyFirebaseToken((body && body.idToken) || ''); }" },
  { name: 'the query reflected into an html 405 on /api/invite-peek', inv: 'I3',
    from: "      if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });\n      return invitePeek(request, env, url);",
    to: "      if (request.method !== 'GET') return new Response('<p>not allowed: ' + decodeURIComponent(url.search) + '</p>', { status: 405, headers: { 'content-type': 'text/html' } });\n      return invitePeek(request, env, url);" },
  { name: 'the dose limiter\'s "no" ignored', inv: 'I4',
    // Every limiter goes through rateLimited() now; the plant drops the dose route's answer to it.
    from: "      if (await rateLimited(limiter, 'dose:' + clientIpKey(request), 'dose')) return json({ error: 'rate' }, 429);",
    to: "      await rateLimited(limiter, 'dose:' + clientIpKey(request), 'dose');" },
];

function loadKnown() {
  const f = process.env.CUBBY_KNOWN_FINDINGS || path.join(os.homedir(), 'cubby-reports', 'known-findings.json');
  /* tools/nightly_report.js keeps it as { id: { firstSeen, lastSeen, fixedOn? } }: a finding marked fixed
     is no longer excused, so if it comes back it blocks again. */
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return new Set(Array.isArray(j) ? j : Object.keys(j).filter((k) => !(j[k] && j[k].fixedOn))); } catch (e) { return null; }
}

(async () => {
  const replayFile = arg('replay', null);
  if (replayFile) return replay(replayFile);
  const real = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
  let failed = 0;
  if (SELF) {
    console.log('\nfuzz_worker self-test: three planted bugs in a temp copy of worker.js, ' + SECONDS + ' s, seed ' + SEED);
    let mutant = real, planted = 0;
    for (const p of PLANTS) {
      const c = mutant.split(p.from).length - 1;
      if (c !== 1) { console.log('  FAIL plant site for "' + p.name + '" found ' + c + ' times (worker.js moved: update PLANTS)'); failed++; continue; }
      mutant = mutant.replace(p.from, p.to); planted++;
    }
    const m = await fuzz(mutant, SEED, SECONDS, 'mutant');
    for (const p of PLANTS) {
      const hit = m.findings.find((f) => f.inv === p.inv && (p.inv !== 'I1' || /purge/.test(f.route)) && (p.inv !== 'I3' || /invite-peek/.test(f.route)) && (p.inv !== 'I4' || /dose/.test(f.route)));
      if (hit) console.log('  ok   planted ' + p.name + ' is found (' + hit.inv + ' ' + hit.sig + ', first at request ' + hit.firstAt + ')');
      else { console.log('  FAIL planted ' + p.name + ' was NOT found in ' + m.requests + ' requests'); failed++; }
    }
    console.log('  (' + m.requests + ' requests against the mutant, ' + m.findings.length + ' distinct findings)');
  }
  const res = await fuzz(real, SEED + (SELF ? 1 : 0), SECONDS, 'worker.js');
  const base = report(res, OUT, 'worker.js');
  console.log('\nfuzz_worker: ' + res.requests + ' requests against the real worker.js in ' + res.seconds + ' s (seed ' + res.seed + '), statuses ' + JSON.stringify(res.statuses));
  for (const f of res.findings) console.log('  FINDING ' + f.id + ' ' + f.inv + ' ' + f.route + ' :: ' + f.sig + ' (' + f.count + 'x)\n          ' + String(f.detail).slice(0, 160) + '\n          repro: ' + f.repro);
  if (!res.findings.length) console.log('  no invariant broken');
  console.log('  report: ' + base + '.md');
  if (SELF) {
    /* What blocks a push, beyond the planted bugs: any reflection into HTML (I3) always, and any finding
       that is not on this machine's known list. The list lives OUTSIDE the repo (~/cubby-reports, kept by
       tools/nightly.sh), because the repo is public and an open bug is not published before it is fixed.
       With no list (CI, a fresh Mac) the other invariants are reported, not blocking. */
    const known = loadKnown();
    const blocking = res.findings.filter((f) => f.inv === 'I3' || (known && !known.has(f.id)));
    blocking.forEach((f) => { console.log('  FAIL ' + (f.inv === 'I3' ? 'input reflected into HTML: ' : 'new finding, not on the known list: ') + f.id + ' ' + f.route + ' :: ' + f.sig); failed++; });
    console.log('\nFUZZ-WORKER SELF-TEST: ' + (failed ? 'FAIL' : 'PASS') + (res.findings.length ? ' (the real worker.js has ' + res.findings.length + ' open finding(s)' + (known ? ', all on the known list' : '; no known list on this machine, so only I3 blocks') + ')' : ''));
    process.exit(failed ? 1 : 0);
  }
  console.log('\nFUZZ-WORKER: ' + (res.findings.length ? 'FINDINGS ' + res.findings.length : 'CLEAN'));
  process.exit(res.findings.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
