#!/usr/bin/env node
/* Does a sign-in email REACH a mailbox, as far as Resend can tell? The live half of the 16 Nov 2026 fix
 * (docs/postmortems/2026-11-16-signin-email-not-delivered.md, EMAIL.md §9c).
 *
 * It asks the real Worker for a sign-in code for each of Resend's documented test addresses, then asks
 * /api/signin-status about each send until the answer settles, and compares:
 *     delivered   -> delivered       (Resend's "delivered" test)
 *     bounced     -> undeliverable   (an SMTP 550 5.1.1)
 *     suppressed  -> undeliverable   (on the suppression list: accepted, never sent)
 * each as <name> at resend.dev, Resend's documented test domain (EXPECT below builds them, so no address
 * sits in this file for tools/address_check.js to read). Not "complained": a complaint normally puts an address on the suppression list, so a second run
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
 *     against a stand-in Worker on 127.0.0.1 only (a port in EMU_PORT_RANGE when one is set), on a clock
 *     of its own so nothing waits: a right world passes, and so does one with the status route's own
 *     limiter (5 asks a minute) where two emails settle only on their third ask, with no ask refused; each
 *     wrong one (a suppressed address answered delivered, every answer unknown, an older Worker with no
 *     sendRef, a status route that never settles, every ask refused by the limiter) must fail with its own
 *     reason; and the live mode refuses to start without its two flags, sending nothing.
 *
 * THE SCHEDULE (round-6 skeptic, M-S7). /api/signin-status has a limiter bucket of its own, 5 asks a
 * minute per network (wrangler.toml, signinGuard's 'status:'), and this check asks about three emails from
 * one network. It used to ask about all three at 8, 12, 20, 30 and 45 seconds, up to 6 asks in its
 * first 12 seconds; the sixth could be refused, and a 429 was read as 'unknown', so a bounce that settled
 * slowly could fail the founder's one live run for no fault (the self-test's limited world shows it).
 * Now it asks about one email at a time, round robin, one ask every 15 seconds (4 a minute), for up to
 * 3 minutes, and a 429 is "ask again later". Cloudflare's limiter is approximate and per data centre,
 * so 4 a minute is a margin under 5, not a guarantee; a run that was refused says so by name.
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

const RESEND_TEST_DOMAIN = 'resend.dev';
const EXPECT = [
  ['delivered', 'delivered'],
  ['bounced', 'undeliverable'],
  ['suppressed', 'undeliverable'],
].map(([name, want]) => [name + '@' + RESEND_TEST_DOMAIN, want]);
const SETTLED = new Set(['delivered', 'undeliverable']);
const FIRST_ASK_MS = 8000, ASK_GAP_MS = 15000, LAST_ASK_MS = 180000;

/* The checker itself. post(path, body) -> {status, body}; wait(ms) -> Promise. Returns { ok, lines }. */
async function check(post, wait, opts) {
  opts = opts || {};
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
    sends.push({ email, want, ref, got: 'unknown', asks: 0, limited: 0 });
  }
  /* One email at a time, round robin, ASK_GAP_MS apart (THE SCHEDULE, above). */
  await wait(FIRST_ASK_MS);
  for (let t = FIRST_ASK_MS, k = 0; t <= LAST_ASK_MS; t += ASK_GAP_MS) {
    const open = sends.filter((s) => !SETTLED.has(s.got));
    if (!open.length) break;
    const s = open[k++ % open.length];
    const q = await post('/api/signin-status', { ref: s.ref });
    s.asks++;
    if (q.status === 429) s.limited++;   // the status route's own limiter: ask again later, never an answer
    else s.got = q.status === 200 && q.body && typeof q.body.state === 'string' ? q.body.state : 'unknown';
    await wait(ASK_GAP_MS);
  }
  for (const s of sends) {
    say(s.got === s.want, s.email + ': ' + s.got + (s.got === s.want ? '' : ', expected ' + s.want) + (s.limited ? ' (' + s.limited + ' of ' + s.asks + ' asks refused by the status limiter)' : ''));
  }
  if (sends.length && sends.every((s) => s.asks > 0 && s.limited === s.asks)) {
    say(false, 'every status ask was refused (429): another client on this network is using the status route\'s 5 a minute, so this run proves nothing. Try again later');
  } else if (sends.length && sends.every((s) => s.got === 'unknown')) {
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
/* clock.now is the self-test's own time, moved only by its wait(), so the limiter below can be modelled
   without anybody waiting. world.limit: the status route's asks allowed per 60 s (wrangler.toml: 5). */
function standIn(world, clock) {
  const seen = [], statusAt = [], asked = new Map();
  let refused = 0;
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      let j = {}; try { j = JSON.parse(b || '{}'); } catch (e) {}
      seen.push(req.url);
      const send = (o, s) => { res.writeHead(s || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/api/signin-code') return send(Object.assign({ ok: true, hasCode: true, hasLink: true }, world.noRef ? {} : { sendRef: 'ref-' + j.email }));
      if (req.url === '/api/signin-status') {
        if (world.limit !== undefined) {
          const now = clock ? clock.now : 0;
          if (statusAt.filter((t) => t > now - 60000).length >= world.limit) { refused++; return send({ error: 'rate_limited' }, 429); }
          statusAt.push(now);
        }
        const email = String(j.ref || '').replace(/^ref-/, ''), n = (asked.get(email) || 0) + 1;
        asked.set(email, n);
        return send({ state: world.answer(email, n) });
      }
      send({ error: 'not_found' }, 404);
    });
  });
  return { server, seen, refused: () => refused };
}
/* Inside EMU_PORT_RANGE when one is set (the band a session agreed to use), else MAIL_CHECK_PORT, else any. */
async function listenLocal(server) {
  const band = /^(\d+)-(\d+)$/.exec(process.env.EMU_PORT_RANGE || '');
  const tries = band ? Array.from({ length: Number(band[2]) - Number(band[1]) + 1 }, (_, i) => Number(band[1]) + i) : [Number(process.env.MAIL_CHECK_PORT) || 0];
  for (const p of tries) {
    const got = await new Promise((r) => { server.once('error', () => r(0)); server.listen(p, '127.0.0.1', () => r(server.address().port)); });
    if (got) return got;
  }
  throw new Error('no free port for the stand-in' + (band ? ' in EMU_PORT_RANGE ' + band[0] : ''));
}
async function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 400) : '')); } };
  const want = new Map(EXPECT);
  /* Slow to settle: 'sent' on the first two asks for that email, its real answer from the third. */
  const slow = (e, n) => (e === 'suppressed@' + RESEND_TEST_DOMAIN || n >= 3 ? want.get(e) : 'sent');
  const worlds = [
    ['a right world passes', true, { answer: (e) => want.get(e) }, null],
    ['with the status route\'s own limit (5 a minute), two emails that settle only on their third ask still pass, and no ask is refused', true, { limit: 5, answer: slow }, null, true],
    ['a suppressed address answered delivered fails, naming it', false, { answer: (e) => (e === 'suppressed@' + RESEND_TEST_DOMAIN ? 'delivered' : want.get(e)) }, /suppressed@resend\.dev: delivered, expected undeliverable/],
    ['every answer unknown fails, and says to check the key', false, { answer: () => 'unknown' }, /RESEND_API_KEY is Full access/],
    ['an older Worker with no sendRef fails, saying so', false, { noRef: true, answer: () => 'unknown' }, /no sendRef/],
    ['a status that never settles fails', false, { answer: () => 'sent' }, /delivered@resend\.dev: sent, expected delivered/],
    ['every status ask refused (429) fails, and says the limiter refused them, not the key', false, { limit: 0, answer: (e) => want.get(e) }, /every status ask was refused \(429\)/],
  ];
  for (const [name, expectOk, world, reason, noneRefused] of worlds) {
    const clock = { now: 0 };
    const { server, seen, refused } = standIn(world, clock);
    const port = await listenLocal(server);
    const r = await check(httpPost('http://127.0.0.1:' + port), async (ms) => { clock.now += ms; }, { limiterWait: 1 });
    await new Promise((res) => { server.close(res); server.closeAllConnections(); });
    ok(name, r.ok === expectOk && (!reason || r.lines.some((l) => reason.test(l))) && seen.length > 0 && (!noneRefused || refused() === 0), { lines: r.lines, refused: refused() });
  }
  /* The live mode must refuse to start without BOTH flags, and send nothing. */
  const { server, seen } = standIn({ answer: () => 'delivered' });
  const port = await listenLocal(server);
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
