/* Did the sign-in email actually go? The same Worker, on the REAL runtime: worker.js inside workerd
 * (Miniflare, local and offline), with its real Cache API, its real AbortSignal.timeout, its real rate
 * limiter binding and its real console. test/signin-delivery.test.js covers every branch in Node with
 * stand-ins for those; this proves the four things a stand-in could get wrong:
 *   1. a send answers a sendRef, and workerd's console carries exactly one signin_send line with Resend's
 *      id and no address;
 *   2. the sendRef finds its entry in workerd's own cache, so /api/signin-status answers 'undeliverable'
 *      for a suppressed email, and the cooldown still answers 'cached' for a repeat, carrying that
 *      settled state (state: 'undeliverable', read from the same cache); and when nothing has asked the
 *      status route yet (a reload before the panel's first ask), the cooldown looks once itself, through
 *      workerd's fetch, and says it too (round 7);
 *   3. workerd's cache holds the cooldown under the hashed key, and NOTHING under the address: asked from
 *      outside with the key the old Worker used (cooldown.cubby.internal/code/<address>), it has nothing
 *      (on 274848d4 it had the entry);
 *   4. a Resend that never answers is 'unknown' within the timeout, and the status route's own limiter
 *      bucket (a real rate-limit binding at wrangler.toml's 5 a minute) refuses the sixth ask while a code
 *      request from the same network still goes.
 * Resend, Google and Firestore are a fetcher in this process (outboundService); this process refuses any
 * socket beyond loopback and the run fails if one was tried.
 *
 *   node test/signin-delivery-workerd.test.js       (gate signin-delivery-workerd, emulator tier: it starts
 *                                                     a runtime; WEB_PORT is workerd's port)
 *   SIGNIN_DELIVERY_WORKER=<path to a worker.js>    grade that file instead (15 checks: on 274848d4, 10 red, the address
 *                                                   key among them; on fe9edbda, 2: the cooldown answers carried no state;
 *                                                   on 24c349f5, 1: nothing asked yet, so no state)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const nodeCrypto = require('crypto');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const HOST = 'https://little-cubby.com';
const PROJECT = 'little-log-a9caa';
const FS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const RESEND_KEY = 're_SECRETKEYfortests_0123';
/* Gmail's own rules (dots and +tags) are what the cooldown key normalises, so a few addresses here are at
   that domain. They are made-up local parts, built at run time, and nothing in this file sends anything:
   every outside call is a stand-in. */
const GMAIL = 'gmail' + '.com';
const { privateKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SA = { project_id: PROJECT, client_email: 'cubby@' + PROJECT + '.iam.gserviceaccount.com', private_key: privateKey };

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Offline, and checked: nothing in this process may open a socket beyond loopback. */
const outbound = [];
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\]|::ffff:127(\.\d{1,3}){3})$/i;
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let a = args[0]; if (Array.isArray(a)) a = a[0];
  const host = a && typeof a === 'object' ? (a.path ? null : String(a.host || 'localhost')) : (typeof args[1] === 'string' ? args[1] : 'localhost');
  if (host && !LOOPBACK.test(host)) {
    outbound.push(host);
    process.nextTick(() => this.destroy(Object.assign(new Error('offline: refused ' + host), { code: 'ECONNREFUSED' })));
    return this;
  }
  return realConnect.apply(this, args);
};

/* ---- the world outside our code, as an outbound fetcher ---- */
const world = { docs: new Map(), times: new Map(), mail: [], events: new Map(), reads: [], hang: false };
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
async function outside(req) {
  const url = req.url, method = req.method;
  if (url === 'https://oauth2.googleapis.com/token') return J({ access_token: 'ya29.tok', expires_in: 3600 });
  if (url === 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode') return J({ oobLink: 'https://' + PROJECT + '.firebaseapp.com/__/auth/action?mode=signIn&oobCode=OOBSECRET&apiKey=AIzaTest' });
  if (url === FS + ':commit' && method === 'POST') {
    const wr = ((await req.json()).writes || [])[0] || {};
    const id = String((wr.update && wr.update.name) || wr.delete || '').split('/signinCodes/')[1];
    const t = new Date(Date.UTC(2026, 10, 16, 12) + world.mail.length * 1000 + world.docs.size).toISOString();
    if (wr.delete) { world.docs.delete(id); return J({ writeResults: [{}], commitTime: t }); }
    world.docs.set(id, wr.update.fields); world.times.set(id, t);
    return J({ writeResults: [{ updateTime: t }], commitTime: t });
  }
  if (url.startsWith(FS + '/signinCodes/') && method === 'GET') {
    const id = url.slice((FS + '/signinCodes/').length);
    return world.docs.has(id) ? J({ name: FS + '/signinCodes/' + id, fields: world.docs.get(id), updateTime: world.times.get(id) }) : J({ error: { status: 'NOT_FOUND' } }, 404);
  }
  if (url === 'https://api.resend.com/emails' && method === 'POST') {
    const m = await req.json(); const id = nodeCrypto.randomUUID();
    world.mail.push(Object.assign({ id }, m));
    return J({ id });
  }
  if (url.startsWith('https://api.resend.com/emails/')) {
    const id = decodeURIComponent(url.slice('https://api.resend.com/emails/'.length));
    world.reads.push(id);
    const m = world.mail.find((x) => x.id === id) || {};
    if (world.hang) return new Promise((res) => setTimeout(() => res(J({ id, last_event: 'delivered', to: [m.to], html: m.html })), 9000));
    return J({ object: 'email', id, to: [m.to], subject: m.subject, html: m.html, last_event: world.events.get(id) || 'sent' });
  }
  return new Response('unstubbed: ' + method + ' ' + url, { status: 599 });
}

(async () => {
  const file = process.env.SIGNIN_DELIVERY_WORKER ? path.resolve(process.env.SIGNIN_DELIVERY_WORKER) : path.join(ROOT, 'worker.js');
  const src = fs.readFileSync(file, 'utf8');
  const { findMiniflare } = await import(pathToFileURL(path.join(ROOT, 'workers', 'admin', 'dev', 'd1-miniflare.mjs')).href);
  const mfi = findMiniflare(ROOT);   // throws, with what to do, if the pinned Miniflare is not there: never a skip
  console.log('signin-delivery-workerd: ' + path.relative(process.cwd(), file) + ' on miniflare ' + mfi.version + ' (workerd ' + mfi.workerd + ')');
  process.env.MINIFLARE_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-delivery-mfcache-'));
  const { Miniflare } = createRequire(__filename)(mfi.dir);

  const toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const compatibilityDate = (/^compatibility_date\s*=\s*"([^"]+)"/m.exec(toml) || [])[1];
  const modules = { 'worker.js': { type: 'esm', contents: src } };
  for (const im of src.matchAll(/^import\s[^;]*?from\s+['"]\.\/([^'"]+)['"]/gm)) modules[im[1]] = { type: 'esm', contents: fs.readFileSync(path.join(ROOT, im[1]), 'utf8') };
  const text = (value) => ({ type: 'text', value });
  const logs = [];
  const port = Number(process.env.WEB_PORT) || 0;
  const mf = new Miniflare({
    host: '127.0.0.1', port, cf: false,
    handleStructuredLogs: (l) => logs.push(l),
    workers: [{
      config: { name: 'cubby', compatibilityDate, manifest: { mainModule: 'worker.js', modules },
        env: { FIREBASE_SERVICE_ACCOUNT: text(JSON.stringify(SA)), RESEND_API_KEY: text(RESEND_KEY), MAIL_FROM: text('Cubby <noreply@mail.little-cubby.com>'),
          SIGNIN_RATE_LIMITER: { type: 'rate-limit', namespace: '1001', simple: { limit: 5, period: 60 } } } },
      dev: { outboundService: { type: 'fetcher', handler: outside }, stripCfConnectingIp: false },
    }],
  });
  const stop = async () => { try { await mf.dispose(); } catch (e) {} };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stop().then(() => process.exit(1)); });
  try {
    await mf.ready;
    const post = async (p, body, h) => {
      const r = await mf.dispatchFetch(HOST + p, { method: 'POST', headers: Object.assign({ origin: HOST, 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' }, h || {}), body: JSON.stringify(body) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
      return { status: r.status, body: j, text: t };
    };
    const lines = () => logs.map((l) => String(l.message || ''));

    console.log('\n1. a send answers a sendRef, and workerd\'s console holds one line with Resend\'s id and no address');
    const addr = 'zz.tester+k1@' + GMAIL;
    const l0 = logs.length;
    const s = await post('/api/signin-code', { email: addr });
    const m = world.mail[world.mail.length - 1] || {};
    ok('the code sender answers a sendRef on workerd', s.status === 200 && s.body && /^[A-Za-z0-9_-]{22}$/.test(String(s.body.sendRef || '')), s.body);
    const sendLines = lines().slice(l0).filter((l) => /signin_send/.test(l));
    ok('one signin_send line, holding Resend\'s id', sendLines.length === 1 && sendLines[0].includes(m.id || 'none'), lines().slice(l0));
    const code = (/>(\d{6})</.exec(m.html || '') || [])[1] || 'nocode';
    ok('and no line holds the address, its local part, the code or the link', lines().slice(l0).every((l) => !l.includes(addr) && !l.includes('tester') && !l.includes(code) && !l.includes('OOBSECRET')), lines().slice(l0));

    console.log('\n2. the sendRef finds its entry in workerd\'s cache, and the cooldown still holds');
    world.events.set(m.id, 'suppressed');
    const st = await post('/api/signin-status', { ref: s.body && s.body.sendRef });
    ok('a suppressed email is undeliverable, through the real Cache API', st.status === 200 && st.body && st.body.state === 'undeliverable' && Object.keys(st.body).join() === 'state', st.body);
    ok('and the answer holds nothing of the email', !st.text.includes(addr) && !st.text.includes(code) && !st.text.includes('sign-in code'), st.text);
    const again = await post('/api/signin-code', { email: addr });
    ok('a repeat inside the minute is answered from the cooldown', again.status === 200 && again.body && again.body.cached === true && world.mail.length === 1, [again.body, world.mail.length]);
    /* Skeptic M-S1: that answer says what the status route already found, read back through workerd's cache. */
    ok('and that cooldown answer says undeliverable, so the panel never says "use that one" over it', again.body && again.body.state === 'undeliverable' && !('sendRef' in again.body), again.body);
    /* Round 7 (R6M2-2): a reload before the panel's first ask. Nothing asked the status route, so the
       cooldown looks once itself, through workerd's fetch and the same cache entry. */
    const NET2 = { 'CF-Connecting-IP': '198.51.100.9' };
    const r1 = await post('/api/signin-code', { email: 'reload@example.org' }, NET2);
    const rm = world.mail[world.mail.length - 1] || {};
    world.events.set(rm.id, 'suppressed');
    const rr0 = world.reads.length, rmail = world.mail.length;
    const r2 = await post('/api/signin-code', { email: 'reload@example.org' }, NET2);
    ok('nothing asked yet: the cooldown answer looks once itself and says undeliverable, on workerd',
      r1.status === 200 && r2.body && r2.body.cached === true && r2.body.state === 'undeliverable' && world.reads.length - rr0 === 1 && world.mail.length === rmail, [r2.body, world.reads.length - rr0, world.mail.length - rmail]);

    console.log('\n3. workerd\'s cache holds the cooldown under the hashed key, and nothing under the address');
    const caches = await mf.getCaches();
    const plain = await caches.default.match('https://cooldown.cubby.internal/code/' + encodeURIComponent('zztester@' + GMAIL));
    ok('asked with the key the old Worker used (the address), the cache has nothing', !plain, plain ? await plain.text() : null);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-delivery-wd-'));
    for (const k of Object.keys(modules)) { fs.mkdirSync(path.dirname(path.join(dir, k)), { recursive: true }); fs.writeFileSync(path.join(dir, k === 'worker.js' ? 'worker.mjs' : k), modules[k].contents); }
    const mod = await import(pathToFileURL(path.join(dir, 'worker.mjs')).href);
    const hashed = mod.__signin && mod.__signin.cooldownRequest ? (await mod.__signin.cooldownRequest(SA, 'code', addr)).url : '';
    const hit = hashed ? await caches.default.match(hashed) : null;
    ok('asked with the hashed key, it has the cooldown, which names no address', !!hit && !/@/.test(await hit.clone().text()) && !/@|%40|tester/i.test(hashed), hashed);
    fs.rmSync(dir, { recursive: true, force: true });

    console.log('\n4. a Resend that never answers is unknown in time, and polling has its own limiter bucket');
    const s2 = await post('/api/signin-code', { email: 'pat@example.org' });
    world.hang = true;
    const t0 = Date.now();
    const slow = await post('/api/signin-status', { ref: s2.body && s2.body.sendRef });
    world.hang = false;
    ok('unknown, within the timeout, on workerd\'s AbortSignal.timeout', slow.body && slow.body.state === 'unknown' && Date.now() - t0 < 8000, [slow.body, Date.now() - t0]);
    const IP = { 'CF-Connecting-IP': '203.0.113.44' };
    const asks = [];
    for (let i = 0; i < 6; i++) asks.push((await post('/api/signin-status', { ref: 'x'.repeat(22) }, IP)).status);
    const c = await post('/api/signin-code', { email: 'budget@example.org' }, IP);
    const x = await post('/api/signin-status', { ref: 'x'.repeat(22) }, { origin: 'https://evil.example' });
    ok('a real rate-limit binding refuses the sixth status ask from one network', asks.slice(0, 5).every((v) => v === 200) && asks[5] === 429, asks);
    ok('and a code request from that network still goes', c.status === 200 && c.body && c.body.hasCode === true, c.body);
    ok('another origin is refused', x.status === 403, x.status);
  } catch (e) {
    fail++; console.log('  FAIL the run threw: ' + String((e && e.stack) || e).slice(0, 600));
  } finally {
    await stop();
  }
  ok('nothing in this process tried a socket beyond loopback', outbound.length === 0, outbound);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SIGNIN-DELIVERY-WORKERD: FAIL' : 'SIGNIN-DELIVERY-WORKERD: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
