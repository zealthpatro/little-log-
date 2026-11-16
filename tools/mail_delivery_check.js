#!/usr/bin/env node
/* Does a sign-in email REACH a mailbox, as far as Resend can tell? The live half of the 16 Nov 2026 fix
 * (docs/postmortems/2026-11-16-signin-email-not-delivered.md, EMAIL.md §9c).
 *
 * It asks the real Worker for a sign-in code for each of Resend's documented test addresses, then asks
 * /api/signin-status about each send until the answer settles, and compares:
 *     delivered@resend.dev   -> delivered       (Resend's "delivered" test)
 *     bounced@resend.dev     -> undeliverable   (an SMTP 550 5.1.1)
 *     suppressed@resend.dev  -> undeliverable   (on the suppression list: accepted, never sent)
 * (Not complained@resend.dev: a complaint normally puts an address on the suppression list, so a second run
 * could see it suppressed, and the check would flip for a reason that is not a fault.)
 * Resend's test addresses do not touch the sending domain's reputation, but each one is a real send that
 * counts against the account's quota, and each mints a sign-in code in production Firestore for an address
 * nobody can read. So:
 *
 *   NEVER RUN IT LIVE WITHOUT THE FOUNDER'S YES. It refuses to, unless given BOTH flags:
 *     node tools/mail_delivery_check.js --live --yes-send-real-email [--base=https://little-cubby.com]
 *   It is not in tools/gates.js's live tier and not on any schedule.
 *
 *   node tools/mail_delivery_check.js --self-test   (gate mail-delivery-self, tree tier) runs the checker
 *     against a stand-in Worker on 127.0.0.1 only: a right world passes, and each wrong one (a suppressed
 *     address answered delivered, every answer unknown, an older Worker with no sendRef, a status route that
 *     never settles) must fail with its own reason; and the live mode refuses to start without its two
 *     flags, sending nothing.
 *
 * What a red live run means:
 *   - every answer unknown: the Worker cannot read emails back. The likeliest reason is a Sending-access
 *     RESEND_API_KEY (Resend answers 401 restricted_api_key); the panel then says nothing new to anyone.
 *   - delivered@ not delivered: mail to a working inbox is not getting through, for every parent.
 *   - suppressed@ or bounced@ not undeliverable: the panel would not warn a parent whose email cannot come.
 *   - no sendRef: the Worker serving the base URL is older than this check.
 */
'use strict';
const http = require('http');

const ARGS = process.argv.slice(2);
const flag = (f) => ARGS.includes(f);
const opt = (k, d) => { const a = ARGS.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };

const EXPECT = [
  ['delivered@resend.dev', 'delivered'],
  ['bounced@resend.dev', 'undeliverable'],
  ['suppressed@resend.dev', 'undeliverable'],
];
const SETTLED = new Set(['delivered', 'undeliverable']);

/* The checker itself. post(path, body) -> {status, body}; wait(ms) -> Promise. Returns { ok, lines }. */
async function check(post, wait, opts) {
  opts = opts || {};
  const asks = opts.asks || [8000, 12000, 20000, 30000, 45000];
  const lines = [];
  let ok = true;
  const say = (good, msg) => { lines.push((good ? 'ok   ' : 'FAIL ') + msg); if (!good) ok = false; };
  const sends = [];
  for (const [email, want] of EXPECT) {
    let r = await post('/api/signin-code', { email });
    if (r.status === 429) { await wait(opts.limiterWait || 61000); r = await post('/api/signin-code', { email }); }
    const ref = r.body && typeof r.body.sendRef === 'string' ? r.body.sendRef : '';
    if (r.status !== 200 || !(r.body && r.body.ok)) { say(false, email + ': the send itself failed (' + r.status + ' ' + JSON.stringify(r.body) + ')'); continue; }
    if (!ref) { say(false, email + ': the Worker answered no sendRef, so it is older than the 16 Nov 2026 fix (or Resend gave no id)'); continue; }
    sends.push({ email, want, ref, got: 'unknown' });
  }
  let t = 0;
  for (const at of asks) {
    await wait(at - t); t = at;
    for (const s of sends) {
      if (SETTLED.has(s.got)) continue;
      const q = await post('/api/signin-status', { ref: s.ref });
      s.got = q.status === 200 && q.body && typeof q.body.state === 'string' ? q.body.state : 'unknown';
    }
    if (sends.every((s) => SETTLED.has(s.got))) break;
  }
  for (const s of sends) say(s.got === s.want, s.email + ': ' + s.got + (s.got === s.want ? '' : ', expected ' + s.want));
  if (sends.length && sends.every((s) => s.got === 'unknown')) {
    say(false, 'every answer was unknown: the Worker cannot read emails back from Resend. Check that RESEND_API_KEY is Full access (a Sending-access key gets 401 restricted_api_key)');
  }
  return { ok, lines };
}

function httpPost(base) {
  const u = new URL(base);
  return (p, body) => new Promise((resolve) => {
    const data = JSON.stringify(body);
    const lib = u.protocol === 'https:' ? require('https') : http;
    const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: p, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), origin: u.origin, 'user-agent': 'cubby-mail-delivery-check' } }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j }); });
    });
    req.on('error', () => resolve({ status: 0, body: null }));
    req.setTimeout(30000, () => { req.destroy(); });
    req.end(data);
  });
}

/* ---- --self-test: a stand-in Worker on 127.0.0.1, never anything else ---- */
function standIn(world) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      let j = {}; try { j = JSON.parse(b || '{}'); } catch (e) {}
      seen.push(req.url);
      const send = (o, s) => { res.writeHead(s || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/api/signin-code') return send(Object.assign({ ok: true, hasCode: true, hasLink: true }, world.noRef ? {} : { sendRef: 'ref-' + j.email }));
      if (req.url === '/api/signin-status') return send({ state: world.answer(String(j.ref || '').replace(/^ref-/, '')) });
      send({ error: 'not_found' }, 404);
    });
  });
  return { server, seen };
}
async function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 400) : '')); } };
  const want = new Map(EXPECT);
  const worlds = [
    ['a right world passes', true, { answer: (e) => want.get(e) }, null],
    ['a suppressed address answered delivered fails, naming it', false, { answer: (e) => (e === 'suppressed@resend.dev' ? 'delivered' : want.get(e)) }, /suppressed@resend\.dev: delivered, expected undeliverable/],
    ['every answer unknown fails, and says to check the key', false, { answer: () => 'unknown' }, /RESEND_API_KEY is Full access/],
    ['an older Worker with no sendRef fails, saying so', false, { noRef: true, answer: () => 'unknown' }, /no sendRef/],
    ['a status that never settles fails', false, { answer: () => 'sent' }, /delivered@resend\.dev: sent, expected delivered/],
  ];
  for (const [name, expectOk, world, reason] of worlds) {
    const { server, seen } = standIn(world);
    const port = await new Promise((r) => server.listen(Number(process.env.MAIL_CHECK_PORT) || 0, '127.0.0.1', () => r(server.address().port)));
    const r = await check(httpPost('http://127.0.0.1:' + port), async () => {}, { asks: [1, 2, 3], limiterWait: 1 });
    await new Promise((res) => { server.close(res); server.closeAllConnections(); });
    ok(name, r.ok === expectOk && (!reason || r.lines.some((l) => reason.test(l))) && seen.length > 0, r.lines);
  }
  /* The live mode must refuse to start without BOTH flags, and send nothing. */
  const { server, seen } = standIn({ answer: () => 'delivered' });
  const port = await new Promise((r) => server.listen(Number(process.env.MAIL_CHECK_PORT) || 0, '127.0.0.1', () => r(server.address().port)));
  const { spawnSync } = require('child_process');
  const runs = [['--live'], ['--yes-send-real-email'], []].map((a) => spawnSync(process.execPath, [__filename].concat(a, ['--base=http://127.0.0.1:' + port]), { encoding: 'utf8', timeout: 20000 }));
  await new Promise((res) => { server.close(res); server.closeAllConnections(); });
  ok('without both --live and --yes-send-real-email it refuses (exit 2) and sends nothing', runs.every((x) => x.status === 2) && seen.length === 0, runs.map((x) => [x.status, (x.stdout || '').slice(0, 80)]));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'MAIL-DELIVERY-SELF: FAIL' : 'MAIL-DELIVERY-SELF: PASS');
  process.exit(fail ? 1 : 0);
}

(async () => {
  if (flag('--self-test')) return selfTest();
  if (!(flag('--live') && flag('--yes-send-real-email'))) {
    console.log('mail_delivery_check: refusing. A live run sends three real emails through Resend from the production Worker.');
    console.log('Only with the founder\'s yes:  node tools/mail_delivery_check.js --live --yes-send-real-email [--base=https://little-cubby.com]');
    process.exit(2);
  }
  const base = opt('base', 'https://little-cubby.com').replace(/\/$/, '');
  console.log('mail_delivery_check: ' + base + ' (sends ' + EXPECT.length + ' real emails to Resend test addresses)');
  const r = await check(httpPost(base), (ms) => new Promise((res) => setTimeout(res, ms)));
  for (const l of r.lines) console.log('  ' + l);
  console.log(r.ok ? 'MAIL-DELIVERY: PASS' : 'MAIL-DELIVERY: FAIL');
  process.exit(r.ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
