/* Did the sign-in email actually go? The Worker half, driven through the REAL worker.js fetch handler.
 *
 * THE INCIDENT (P0, 16 Nov 2026; docs/postmortems/2026-11-16-signin-email-not-delivered.md). A new Gmail
 * address asked for a sign-in code three times. Resend answered 2xx each time, so the app said "Check your
 * inbox: we just emailed you" and armed the cooldown, and no email ever arrived in any folder. Cubby kept
 * no Resend message id, wrote no log line and had no way to learn that a send was suppressed, bounced or
 * failed after Resend accepted it, so a parent could wait for ever with no hint to use Google or Apple.
 * And the per-address cooldown's Cache API key held the plaintext address, which Cloudflare's zone
 * analytics then listed as a request path.
 *
 * What this proves, with only the world outside our code stood in (Google's token endpoint, Identity
 * Toolkit, Firestore, Resend, the Cache API and the rate limiter; an unstubbed URL throws):
 *   1. a send that Resend accepted with an id answers a sendRef (128 random bits, base64url), and one
 *      without an id answers exactly as before (no sendRef);
 *   2. each send writes ONE log line, `signin_send {kind, status, id}` (or `{kind, status, error}` on a
 *      refusal), and no line of the request holds the address, the code, the link, a token or a key;
 *   3. /api/signin-status maps every Resend last_event to sent, delivered, delayed, undeliverable or
 *      unknown, and never returns or logs the email's body, recipient or subject;
 *   4. every failure is 'unknown': a 401 (a sending-only key), a 403, a 404, a 429, a 500, an answer it
 *      cannot read, a timeout, a ref it did not mint, a malformed one;
 *   5. Resend is asked a bounded number of times per email, and never again once the answer is settled;
 *   6. no cache key holds an address or a sendRef, and the cooldown still holds for the exact address that
 *      armed it, apart for the code and link senders;
 *   7. the status route is same-origin only, and rate limited in a bucket of its own ('status:'), so
 *      polling never spends the code budget.
 *
 *   node test/signin-delivery.test.js               judge this tree's worker.js
 *   node test/signin-delivery.test.js --self-test   then break worker.js twelve ways in memory; each break
 *                                                   must turn its named check red
 *   SIGNIN_DELIVERY_WORKER=<path to a worker.js>    grade that file instead (on 274848d4: 57 of 78 red)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const SELF = process.argv.includes('--self-test');
const HOST = 'https://little-cubby.com';
const PROJECT = 'little-log-a9caa';
const FS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const RESEND_KEY = 're_SECRETKEYfortests_0123';
const ACCESS_TOKEN = 'ya29.SECRETACCESSTOKENfortests';
const OOB_SECRET = 'OOBSECRETcode';
const { privateKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SA = { project_id: PROJECT, client_email: 'cubby@' + PROJECT + '.iam.gserviceaccount.com', private_key: privateKey };
const KEY_BITS = privateKey.split('\n').filter((l) => l && !/-----/.test(l)).slice(1, 4);   // three lines from inside the private key
const REF_RE = /^[A-Za-z0-9_-]{22}$/;
const SUBJECT = 'Your Cubby sign-in code';

/* ---- the world outside our code ------------------------------------------------------------------ */
const world = {};
function resetWorld() {
  Object.assign(world, {
    docs: new Map(), times: new Map(), mail: [], sendReply: null, oob: 0,
    reads: [], events: new Map(), readReply: null,
    cache: new Map(), cacheUrls: new Set(),
    logs: [], clock: 0,
  });
}
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + world.clock;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

globalThis.caches = { default: {
  async match(r) { const u = String(r.url || r); world.cacheUrls.add(u); const v = world.cache.get(u); return v === undefined ? undefined : new Response(v); },
  async put(r, res) { const u = String(r.url || r); world.cacheUrls.add(u); world.cache.set(u, await res.text()); },
  async delete(r) { const u = String(r.url || r); world.cacheUrls.add(u); return world.cache.delete(u); },
} };

globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const method = ((init && init.method) || 'GET').toUpperCase();
  const body = (init && init.body) || null;
  const headers = (init && init.headers) || {};
  if (url === 'https://oauth2.googleapis.com/token') return J({ access_token: ACCESS_TOKEN, expires_in: 3600 });
  if (url === 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode') {
    world.oob++;
    return J({ oobLink: 'https://' + PROJECT + '.firebaseapp.com/__/auth/action?mode=signIn&oobCode=' + OOB_SECRET + world.oob + '&apiKey=AIzaTest' });
  }
  if (url === FS + ':commit' && method === 'POST') {
    const wr = (JSON.parse(body).writes || [])[0] || {};
    const name = String((wr.update && wr.update.name) || wr.delete || '');
    const id = name.split('/signinCodes/')[1];
    const t = new Date(Date.UTC(2026, 10, 16, 12) + world.docs.size * 1000 + world.mail.length).toISOString();
    if (wr.delete) { world.docs.delete(id); return J({ writeResults: [{}], commitTime: t }); }
    world.docs.set(id, wr.update.fields); world.times.set(id, t);
    return J({ writeResults: [{ updateTime: t }], commitTime: t });
  }
  if (url.startsWith(FS + '/signinCodes/') && method === 'GET') {
    const id = url.slice((FS + '/signinCodes/').length);
    return world.docs.has(id) ? J({ name: FS + '/signinCodes/' + id, fields: world.docs.get(id), updateTime: world.times.get(id) }) : J({ error: { status: 'NOT_FOUND' } }, 404);
  }
  if (url === 'https://api.resend.com/emails' && method === 'POST') {
    const m = JSON.parse(body);
    const id = nodeCrypto.randomUUID();
    world.mail.push(Object.assign({ id }, m));
    return world.sendReply ? world.sendReply(m, id) : J({ id });
  }
  if (url.startsWith('https://api.resend.com/emails/')) {
    const id = decodeURIComponent(url.slice('https://api.resend.com/emails/'.length));
    const auth = headers.authorization || headers.Authorization || '';
    world.reads.push({ id, method, auth, signal: !!(init && init.signal) });
    const m = world.mail.find((x) => x.id === id) || {};
    const full = { object: 'email', id, to: [m.to], from: m.from, subject: m.subject, html: m.html, text: null, created_at: '2026-11-16 12:18:49.674981+00' };
    if (world.readReply) return world.readReply(id, init, full);
    return J(Object.assign(full, { last_event: world.events.has(id) ? world.events.get(id) : 'sent' }));
  }
  throw new Error('unstubbed external call: ' + method + ' ' + url);
};

/* A limiter that counts per key, as the binding does (5 a minute in wrangler.toml), and records every key. */
function makeLimiter(max, deny) {
  const counts = new Map(), keys = [];
  return { keys, counts, async limit({ key }) { keys.push(key); const n = (counts.get(key) || 0) + 1; counts.set(key, n); return { success: !deny && n <= max }; } };
}

async function call(w, method, p, body, opts) {
  opts = opts || {};
  const h = { 'content-type': 'application/json', 'CF-Connecting-IP': opts.ip || '198.51.100.7' };
  if (opts.origin !== null) h.Origin = opts.origin || HOST;
  if (opts.referer) h.Referer = opts.referer;
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const lines = [];
  const real = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(real)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try {
    const r = await w.fetch(new Request(HOST + p, init), opts.env, { waitUntil() {}, passThroughOnException() {} });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (e) {}
    return { status: r.status, body: j, text, lines };
  } catch (e) {
    return { status: 0, body: null, text: '', lines, threw: String((e && e.message) || e) };
  } finally {
    Object.assign(console, real);
    world.logs.push(...lines);
  }
}

/* What must never appear in a log line, a status answer or a cache key, for one address and its email. */
function secretsOf(addr, mailItem) {
  const out = [addr, encodeURIComponent(addr), addr.split('@')[0].split('+')[0], RESEND_KEY, ACCESS_TOKEN, OOB_SECRET].concat(KEY_BITS);
  if (mailItem) {
    const code = (/>(\d{6})</.exec(mailItem.html || '') || [])[1];
    if (code) out.push(code);
    out.push(mailItem.subject);
  }
  return out.filter((s) => s && s.length >= 3);
}
const leaks = (text, secrets) => secrets.filter((s) => String(text).includes(s));

async function loadWorker(src, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-delivery-'));
  for (const im of src.matchAll(/^import\s[^;]*?from\s+['"](\.\/[^'"]+)['"]/gm)) {
    const to = path.join(dir, im[1]); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(ROOT, im[1]), to);
  }
  fs.writeFileSync(path.join(dir, 'worker.mjs'), src);
  const mod = await import(pathToFileURL(path.join(dir, 'worker.mjs')).href + '?' + tag);
  return { w: mod.default, mod, dir };
}

const EVENTS = [
  ['queued', 'sent'], ['scheduled', 'sent'], ['sent', 'sent'],
  ['delivered', 'delivered'], ['opened', 'delivered'], ['clicked', 'delivered'], ['complained', 'delivered'],
  ['delivery_delayed', 'delayed'],
  ['bounced', 'undeliverable'], ['suppressed', 'undeliverable'], ['failed', 'undeliverable'], ['canceled', 'undeliverable'],
  ['', 'unknown'], ['something_new', 'unknown'], ['constructor', 'unknown'], ['__proto__', 'unknown'], ['toString', 'unknown'],
];

let serial = 0;
async function suite(src, opts) {
  opts = opts || {};
  const quiet = !!opts.quiet;
  let pass = 0, fail = 0;
  const failed = new Set();
  const say = (s) => { if (!quiet) console.log(s); };
  const ok = (id, n, c, x) => {
    if (c) { pass++; say('  ok   ' + n); }
    else { fail++; failed.add(id); say('  FAIL ' + n + '  [' + id + ']' + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); }
  };
  resetWorld();
  const { w, mod, dir } = await loadWorker(src, 'v' + (++serial));
  const limiter = makeLimiter(1e9);
  const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), RESEND_API_KEY: RESEND_KEY, MAIL_FROM: 'Cubby <noreply@mail.little-cubby.com>', SIGNIN_RATE_LIMITER: limiter };
  const env = (x) => Object.assign({}, ENV, x || {});
  let addrN = 0;
  const fresh = (tag) => tag + (++addrN) + '@example.com';
  const sendCode = (addr, o) => call(w, 'POST', '/api/signin-code', { email: addr }, Object.assign({ env: env() }, o || {}));
  const sendLink = (addr, o) => call(w, 'POST', '/api/send-signin-link', { email: addr }, Object.assign({ env: env() }, o || {}));
  const status = (ref, o) => call(w, 'POST', '/api/signin-status', { ref }, Object.assign({ env: env() }, o || {}));
  const lastMail = () => world.mail[world.mail.length - 1] || {};
  const gap = () => { world.clock += 5000; };

  say('\n1. a send Resend accepted with an id answers a sendRef; one without an id answers as before');
  {
    const a = fresh('ann'), r = await sendCode(a);
    ok('code-sendref', 'the code sender answers a sendRef of 128 random bits, base64url', r.status === 200 && r.body && r.body.hasCode === true && REF_RE.test(String(r.body.sendRef || '')), r.body);
    const b = fresh('bea'), l = await sendLink(b);
    ok('link-sendref', 'and so does the link sender', l.status === 200 && l.body && REF_RE.test(String(l.body.sendRef || '')), l.body);
    ok('sendref-fresh', 'two sends get two different refs', !!(r.body && l.body && r.body.sendRef && r.body.sendRef !== l.body.sendRef));
    ok('sendref-not-id', 'and a ref is not Resend\'s id', !!(r.body && r.body.sendRef) && !world.mail.some((m) => String(r.body.sendRef).includes(m.id) || m.id.includes(String(r.body.sendRef))));
    world.sendReply = () => J({});
    const c = await sendCode(fresh('cat'));
    ok('no-id-no-ref', 'a 2xx with no id is still a send, with no sendRef (the app then behaves as before)', c.status === 200 && c.body && c.body.hasCode === true && !('sendRef' in c.body), c.body);
    world.sendReply = () => new Response('accepted', { status: 200 });
    const d = await sendLink(fresh('dot'));
    ok('nonjson-no-ref', 'and so is a 2xx that is not JSON', d.status === 200 && d.body && d.body.ok === true && !('sendRef' in d.body), d.body);
    world.sendReply = null;
  }

  say('\n2. one log line per send: Resend\'s id, the kind and the status, and never the address');
  {
    const a = 'jane.doe+k1@gmail.com';
    const r = await sendCode(a);
    const m = lastMail();
    const sendLines = r.lines.filter((l) => /^signin_send /.test(l));
    ok('send-log-one-line', 'a code send writes exactly one signin_send line', sendLines.length === 1, r.lines);
    let j = null; try { j = JSON.parse(sendLines[0].slice('signin_send '.length)); } catch (e) {}
    ok('send-log-id', 'holding Resend\'s id, kind code and status 200', !!j && j.id === m.id && j.kind === 'code' && j.status === 200, j);
    const sec = secretsOf(a, m);
    ok('send-log-clean', 'and no line of that request holds the address, the code, the link, a token or a key', r.lines.every((l) => leaks(l, sec).length === 0), r.lines.map((l) => leaks(l, sec)));
    const l = await sendLink('pat@example.org');
    const lm = lastMail();
    const ll = l.lines.filter((x) => /^signin_send /.test(x));
    let lj = null; try { lj = JSON.parse(ll[0].slice('signin_send '.length)); } catch (e) {}
    ok('send-log-link', 'a link send writes its own line, kind link, with its id', ll.length === 1 && !!lj && lj.kind === 'link' && lj.id === lm.id && lj.status === 200, l.lines);
    ok('send-log-link-clean', 'with nothing of the address or the email in it', l.lines.every((x) => leaks(x, secretsOf('pat@example.org', lm)).length === 0), l.lines);
    /* Resend's refusal message can repeat what was sent; only its name may be logged. */
    world.sendReply = (msg) => J({ statusCode: 422, name: 'validation_error', message: 'Invalid `to` field: ' + msg.to }, 422);
    const z = 'zed@example.net';
    const f = await sendCode(z);
    world.sendReply = null;
    const fl = f.lines.filter((x) => /^signin_send /.test(x));
    let fj = null; try { fj = JSON.parse(fl[0].slice('signin_send '.length)); } catch (e) {}
    ok('send-log-refusal', 'a refusal is one line with the status and the error name, and not the message that repeats the address',
      f.status === 502 && fl.length === 1 && !!fj && fj.status === 422 && fj.error === 'validation_error' && f.lines.every((x) => leaks(x, [z, 'zed']).length === 0), f.lines);
    ok('refusal-no-ref', 'and a refusal answers no sendRef', f.body && !('sendRef' in f.body), f.body);
    /* The companion: the matcher above can find what it is looking for. */
    ok('leak-matcher-works', 'companion: the same matcher finds an address, a code and a key planted in a line',
      leaks('signin_send {"to":"' + a + '"}', sec).length > 0 && leaks('code ' + ((/>(\d{6})</.exec(m.html || '') || [])[1] || 'none'), sec).length > 0 && leaks('k=' + RESEND_KEY, sec).length > 0);
  }

  say('\n3. /api/signin-status: one coarse word per Resend event, and nothing of the email');
  {
    const answers = [], allLines = [], allSecrets = [];
    for (const [ev, want] of EVENTS) {
      const a = fresh('ev');
      const s = await sendCode(a);
      const m = lastMail();
      world.events.set(m.id, ev);
      gap();
      const before = world.reads.length;
      const q = await status(s.body && s.body.sendRef);
      answers.push(q);
      allLines.push(...q.lines);
      allSecrets.push(...secretsOf(a, m), m.html.slice(0, 60));
      ok('event-' + (ev || 'empty'), "last_event '" + ev + "' is " + want, q.status === 200 && q.body && q.body.state === want, q.body);
      const rd = world.reads.slice(before);
      if (ev === 'sent') ok('status-get-shape', 'Resend is asked with a GET of that email, the key, and a timeout', rd.length === 1 && rd[0].id === m.id && rd[0].method === 'GET' && rd[0].auth === 'Bearer ' + RESEND_KEY && rd[0].signal, rd);
      if (ev === 'bounced') {
        const sl = q.lines.filter((x) => /^signin_status /.test(x));
        let sj = null; try { sj = JSON.parse(sl[0].slice('signin_status '.length)); } catch (e) {}
        ok('status-log-line', 'one signin_status line per lookup, with the id, the event and the answer', sl.length === 1 && !!sj && sj.id === m.id && sj.event === 'bounced' && sj.state === 'undeliverable' && sj.status === 200, q.lines);
      }
    }
    ok('status-only-state', 'every answer is {state} and nothing else', answers.every((q) => q.body && Object.keys(q.body).join() === 'state'), answers.map((q) => q.body));
    ok('status-no-echo', 'no answer and no log line holds the address, the code, the subject, the HTML or a key', answers.every((q) => leaks(q.text, allSecrets).length === 0) && allLines.every((l) => leaks(l, allSecrets).length === 0),
      answers.map((q) => leaks(q.text, allSecrets)).concat(allLines.map((l) => leaks(l, allSecrets))).filter((x) => x.length));
  }

  say('\n4. every failure is unknown');
  {
    const cases = [
      ['401-unknown', 'a sending-only key (401 restricted_api_key)', () => J({ statusCode: 401, name: 'restricted_api_key', message: 'This API key is restricted to only send emails' }, 401)],
      ['403-unknown', 'a 403', () => J({ statusCode: 403, name: 'invalid_permission' }, 403)],
      ['404-unknown', 'a 404', () => J({ statusCode: 404, name: 'not_found' }, 404)],
      ['429-unknown', 'Resend\'s rate limit (429)', () => J({ statusCode: 429, name: 'rate_limit_exceeded' }, 429)],
      ['500-unknown', 'a 500', () => J({ statusCode: 500, name: 'application_error' }, 500)],
      ['nonjson-unknown', 'a 200 it cannot read', () => new Response('<html>', { status: 200 })],
      ['noevent-unknown', 'a 200 with no last_event', (id, init, full) => J(full)],
      ['throw-unknown', 'a network error', () => { throw new TypeError('Network connection lost'); }],
      /* A 403 that carries a delivered-looking body is still a 403. */
      ['403-body-unknown', 'a 403 whose body says delivered', (id, init, full) => J(Object.assign(full, { last_event: 'delivered' }), 403)],
    ];
    for (const [id, label, reply] of cases) {
      const s = await sendCode(fresh('err'));
      world.readReply = reply;
      gap();
      const q = await status(s.body && s.body.sendRef);
      world.readReply = null;
      ok(id, label + ' is unknown', q.status === 200 && q.body && q.body.state === 'unknown', [q.status, q.body]);
      ok(id + '-clean', label + ': and its log line holds no address', q.lines.every((l) => !/@/.test(l)), q.lines);
    }
    if (opts.slow !== false) {
      const s = await sendCode(fresh('hang'));
      /* Resend never answers unless the request is aborted; with no timeout it answers 'delivered' after 9 s. */
      world.readReply = (id, init, full) => new Promise((res, rej) => {
        const t = setTimeout(() => res(J(Object.assign(full, { last_event: 'delivered' }))), 9000);
        if (init && init.signal) init.signal.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      });
      gap();
      const t0 = realNow();
      const q = await status(s.body && s.body.sendRef);
      world.readReply = null;
      const took = realNow() - t0;
      ok('timeout-unknown', 'a Resend that never answers is unknown, within the timeout', q.body && q.body.state === 'unknown' && took < 8000, { state: q.body && q.body.state, took });
    }
    const readsBefore = world.reads.length;
    const unk = nodeCrypto.randomBytes(16).toString('base64url');
    const u = await status(unk);
    ok('unminted-unknown', 'a well-formed ref this Worker never minted is unknown', u.status === 200 && u.body && u.body.state === 'unknown', u.body);
    const bad = ['', 'abc', 'x'.repeat(21) + '!', 'a/b' + 'c'.repeat(19), 'x'.repeat(23), '../../emails/1234567890'];
    const badAns = [];
    for (const b of bad) badAns.push(await status(b));
    ok('malformed-unknown', 'a malformed ref is unknown', badAns.every((q) => q.status === 200 && q.body && q.body.state === 'unknown'), badAns.map((q) => [q.status, q.body]));
    ok('unknown-asks-nobody', 'and neither of those asks Resend anything', world.reads.length === readsBefore, world.reads.slice(readsBefore));
    const ns = await sendCode(fresh('nokey'));
    gap();
    const nk = await call(w, 'POST', '/api/signin-status', { ref: ns.body && ns.body.sendRef }, { env: env({ RESEND_API_KEY: '' }) });
    ok('nokey-unknown', 'with no Resend key bound, unknown', nk.status === 200 && nk.body && nk.body.state === 'unknown', nk.body);
    const shapes = [await call(w, 'POST', '/api/signin-status', { ref: {} }, { env: env() }), await call(w, 'POST', '/api/signin-status', { ref: 42 }, { env: env() }), await call(w, 'POST', '/api/signin-status', '{nope', { env: env() })];
    ok('status-bad-request', 'a ref that is not a string, or a body that is not JSON, is 400 and never throws', shapes.every((q) => q.status === 400 && !q.threw), shapes.map((q) => [q.status, q.threw]));
    const g = await call(w, 'GET', '/api/signin-status', undefined, { env: env() });
    ok('status-method', 'GET is 405', g.status === 405, g.status);
  }

  say('\n5. Resend is asked a bounded number of times, and never again once it has answered for good');
  {
    const s = await sendCode(fresh('gap'));
    const ref = s.body && s.body.sendRef;
    gap();
    const r0 = world.reads.length;
    await status(ref);
    world.clock += 1000;
    const second = await status(ref);
    ok('lookup-gap', 'two asks a second apart ask Resend once', world.reads.length - r0 === 1 && second.body && second.body.state === 'sent', [world.reads.length - r0, second.body]);
    for (let i = 0; i < 12; i++) { gap(); await status(ref); }
    ok('lookup-cap', 'twelve more asks, five seconds apart, ask Resend six times in all', world.reads.length - r0 === 6, world.reads.length - r0);

    const s2 = await sendCode(fresh('settle'));
    const m2 = lastMail();
    world.events.set(m2.id, 'sent');
    gap();
    const first = await status(s2.body && s2.body.sendRef);
    world.events.set(m2.id, 'suppressed');
    gap();
    const then = await status(s2.body && s2.body.sendRef);
    ok('sent-then-settled', 'sent, then undeliverable once Resend says suppressed', first.body && first.body.state === 'sent' && then.body && then.body.state === 'undeliverable', [first.body, then.body]);
    const r1 = world.reads.length;
    world.events.set(m2.id, 'delivered');
    const later = [];
    for (let i = 0; i < 3; i++) { gap(); later.push((await status(s2.body && s2.body.sendRef)).body); }
    ok('settled-not-asked-again', 'a settled answer is kept: three more asks, no more reads, still undeliverable', world.reads.length === r1 && later.every((b) => b && b.state === 'undeliverable'), [world.reads.length - r1, later]);
  }

  say('\n6. no cache key holds an address or a sendRef, and the cooldown still holds');
  {
    world.cacheUrls.clear();
    /* Addresses no earlier section mailed, so each is a real send (the stand-in cache keeps a cooldown for ever). */
    const addrs = ['jane.doe+k6@gmail.com', 'mum@example.com'];
    const refs = [];
    for (const a of addrs) {
      const c = await sendCode(a); refs.push(c.body && c.body.sendRef);
      const l = await sendLink(a); refs.push(l.body && l.body.sendRef);
    }
    gap();
    for (const r of refs) await status(r);
    const urls = [...world.cacheUrls];
    const words = ['@', '%40', 'jane', 'janedoe', 'mum', 'gmail', 'example'];
    const holds = (u) => words.filter((x) => u.toLowerCase().includes(x));
    ok('cache-keys-seen', 'cache traffic was seen: cooldown keys for both senders and status keys',
      urls.some((u) => /^https:\/\/cooldown\.cubby\.internal\/code\//.test(u)) && urls.some((u) => /^https:\/\/cooldown\.cubby\.internal\/link\//.test(u)) && urls.some((u) => /^https:\/\/signin-status\.cubby\.internal\//.test(u)), urls);
    ok('cache-no-address', 'no cache key holds an address or any piece of one', urls.every((u) => holds(u).length === 0), urls.filter((u) => holds(u).length));
    ok('cache-no-ref', 'and none holds a sendRef', refs.filter(Boolean).length === 4 && urls.every((u) => refs.every((r) => !r || !u.includes(r))), urls);
    ok('cache-matcher-works', 'companion: the same matcher finds the address in the key the old Worker used',
      holds('https://cooldown.cubby.internal/code/' + encodeURIComponent('janedoe@gmail.com')).length > 0);
    const exp = mod.__signin && mod.__signin.cooldownRequest ? (await mod.__signin.cooldownRequest(SA, 'code', 'mum@example.com')).url : '';
    ok('cooldown-key-exported', 'the exported cooldownRequest names the key the code sender used', !!exp && urls.includes(exp), exp);

    const a = fresh('cool');
    const sent0 = world.mail.length;
    await sendCode(a);
    const again = await sendCode(a);
    ok('cooldown-still-holds', 'a second ask for the same address inside the minute is answered from the cooldown and mails nothing', again.body && again.body.cached === true && world.mail.length === sent0 + 1, [again.body, world.mail.length - sent0]);
    const v1 = 'jo.anne' + (++addrN) + '@gmail.com', v2 = v1.replace('.', '');
    const s1 = world.mail.length;
    await sendCode(v1);
    const other = await sendCode(v2);
    ok('cooldown-exact-address', 'a variant that shares the bucket (Gmail dots) is not answered from another address\'s cooldown', other.body && !other.body.cached && world.mail.length === s1 + 2 && lastMail().to === v2, [other.body, world.mail.length - s1]);
    const b = fresh('apart');
    await sendLink(b);
    const s3 = world.mail.length;
    const code = await sendCode(b);
    ok('cooldown-code-link-apart', 'a link sent to an address does not arm its code cooldown', code.body && !code.body.cached && world.mail.length === s3 + 1, code.body);
  }

  say('\n7. same origin only, and a limiter bucket of its own');
  {
    const s = await sendCode(fresh('org'));
    const ref = s.body && s.body.sendRef;
    gap();
    const x = await status(ref, { origin: 'https://evil.example' });
    ok('status-cross-origin-403', 'another origin is refused', x.status === 403, x.status);
    const y = await status(ref, { origin: null });
    ok('status-no-origin-403', 'no Origin and no Referer is refused', y.status === 403, y.status);
    const z = await status(ref, { origin: null, referer: HOST + '/app/' });
    ok('status-referer-ok', 'a same-host Referer is let through', z.status === 200 && z.body && typeof z.body.state === 'string', [z.status, z.body]);
    const deny = makeLimiter(0, true);
    const d = await status(ref, { env: env({ SIGNIN_RATE_LIMITER: deny }) });
    ok('status-limited-429', 'a limiter that says no gets a 429', d.status === 429, d.status);
    ok('status-own-bucket', 'and the bucket it asks for is status:<network>', deny.keys.length === 1 && deny.keys[0] === 'status:198.51.100.7', deny.keys);
    const five = makeLimiter(5);
    const IP = '203.0.113.44';
    const asks = [];
    for (let i = 0; i < 6; i++) { gap(); asks.push((await status(ref, { ip: IP, env: env({ SIGNIN_RATE_LIMITER: five }) })).status); }
    const c = await sendCode(fresh('budget'), { ip: IP, env: env({ SIGNIN_RATE_LIMITER: five }) });
    ok('status-spares-code-budget', 'six status asks from one network: the sixth is 429, and a code request from it still goes',
      asks.slice(0, 5).every((x) => x === 200) && asks[5] === 429 && c.status === 200 && c.body && c.body.hasCode === true, { asks, code: c.status, keys: [...five.counts.keys()] });
  }

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  return { pass, fail, failed };
}

/* ---- --self-test: break worker.js in memory, twelve ways; each must turn its own check red ---- */
const MUTANTS = [
  { name: 'the send log line carries the address', red: 'send-log-clean',
    edits: [["const sendRef = await signinSent(r, 'code');", "const sendRef = await signinSent(r, 'code ' + email);"]] },
  { name: 'a refusal logs Resend\'s message', red: 'send-log-refusal',
    edits: [["const name = j && typeof j.name === 'string' && /^[a-z_]{1,40}$/.test(j.name) ? j.name : '';", 'const name = j && (j.message || j.name);']] },
  { name: 'a debug line logs Resend\'s email', red: 'status-no-echo',
    edits: [['      const j = await r.json();\n', "      const j = await r.json();\n      console.log('resend_email', JSON.stringify(j));\n"]] },
  { name: 'the status answer carries Resend\'s email', red: 'status-only-state',
    edits: [['      const j = await r.json();\n', '      const j = await r.json();\n      globalThis.__resendEmail = j;\n'],
      ['return json({ state: await signinMailState(env, ref) });', 'return json(Object.assign({ state: await signinMailState(env, ref) }, globalThis.__resendEmail || {}));']] },
  { name: 'a 403 is read as an answer', red: '403-body-unknown',
    edits: [["const state = (status >= 200 && status < 300 && SIGNIN_MAIL_STATE.get(event)) || 'unknown';", "const state = SIGNIN_MAIL_STATE.get(event) || 'unknown';"],
      ['    if (r.ok) {\n      const j = await r.json();', '    {\n      const j = await r.json();']] },
  { name: 'suppressed is read as sent', red: 'event-suppressed',
    edits: [["['suppressed', 'undeliverable']", "['suppressed', 'sent']"]] },
  { name: 'the cooldown is keyed by the address again', red: 'cache-no-address',
    edits: [["return new Request('https://cooldown.cubby.internal/' + sender + '/' + _b64urlFromBytes(sig).slice(0, 32));", "return new Request('https://cooldown.cubby.internal/' + sender + '/' + encodeURIComponent(cooldownKeyFor(email)));"]] },
  { name: 'the status route skips the same-origin guard', red: 'status-cross-origin-403',
    edits: [["async function signinStatus(request, env) {\n  const bad = await signinGuard(request, env); if (bad) return bad;", 'async function signinStatus(request, env) {']] },
  { name: 'status polls spend the code bucket', red: 'status-spares-code-budget',
    edits: [["const bucket = where === 'signin_status' ? 'status:' : 'code:';", "const bucket = 'code:';"]] },
  { name: 'no bound on lookups', red: 'lookup-cap',
    edits: [['if (n >= SIGNIN_STATUS_LOOKUPS || now - t < SIGNIN_STATUS_GAP_MS) return last;', 'if (now - t < SIGNIN_STATUS_GAP_MS) return last;']] },
  { name: 'a settled answer is asked again', red: 'settled-not-asked-again',
    edits: [['  if (SIGNIN_MAIL_SETTLED.has(last)) return last;                   // settled: Resend is not asked again\n', '']] },
  { name: 'no timeout on the Resend read', red: 'timeout-unknown', slow: true,
    edits: [['      signal: AbortSignal.timeout(SIGNIN_STATUS_TIMEOUT_MS)\n', '']] },
];

(async () => {
  const file = process.env.SIGNIN_DELIVERY_WORKER ? path.resolve(process.env.SIGNIN_DELIVERY_WORKER) : path.join(ROOT, 'worker.js');
  const src = fs.readFileSync(file, 'utf8');
  console.log('signin-delivery: grading ' + path.relative(process.cwd(), file));
  const res = await suite(src, {});
  let pass = res.pass, fail = res.fail;
  if (SELF) {
    console.log('\n8. --self-test: break worker.js in memory; each break must turn its own check red');
    for (const m of MUTANTS) {
      let broken = src, applied = true;
      for (const [from, to] of m.edits) { if (!broken.includes(from)) applied = false; broken = broken.replace(from, to); }
      if (!applied) { fail++; console.log('  FAIL mutant does not apply to this worker.js: ' + m.name); continue; }
      const r = await suite(broken, { quiet: true, slow: !!m.slow });
      if (r.failed.has(m.red)) { pass++; console.log('  ok   catches: ' + m.name + ' (' + m.red + ' red, ' + r.fail + ' red in all)'); }
      else { fail++; console.log('  FAIL misses: ' + m.name + ' (' + m.red + ' stayed green; red: ' + [...r.failed].join(', ') + ')'); }
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SIGNIN-DELIVERY: FAIL' : 'SIGNIN-DELIVERY: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
