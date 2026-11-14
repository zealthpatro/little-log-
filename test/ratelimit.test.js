/* Every rate limiter in worker.js, and what it does when the limiter itself misbehaves.
 *
 * Production was seen never to return a 429. On 2026-10-27, 73 invalid dose tickets in a row from one
 * IP, one a second, all served from one Cloudflare location (LHR), went through a 10-per-minute limit;
 * the sign-in limiter on /api/invite-peek let 15 paced calls through a 5-per-minute one. Locally the
 * same bindings deny on the sixth call. In between sat nine call sites that each wrapped `.limit()` in
 * a try/catch and threw the error away, so a limiter that throws on every call was indistinguishable
 * from one that allows. (It was neither: bursts did get a few 429s. Cloudflare's limiter is
 * approximate by design and far looser than its number; see wrangler.toml for the measurements.)
 *
 * Failing OPEN is deliberate and stays: a limiter outage must never block a parent signing in or
 * logging a dose. The 404 page-view counter alone fails CLOSED (a lost count costs nothing). Failing
 * SILENTLY, either way, is what this gate forbids. The rule now:
 *   - every limiter call goes through ONE helper, rateLimited(), so there is one place to get it right
 *   - a throw is logged (ratelimit_throw) and the route's policy applies (proceed; page views: no count)
 *   - a reply without a boolean `success` is logged (ratelimit_shape), same policy
 *   - a denial is logged (ratelimit_deny) and the route answers 429
 *   - a log line names the route and the reason, NEVER the key: every key carries the client's IP or
 *     network, and the limiter's own error text or reply may repeat it
 *   - at most 5 lines a minute per reason and route in an isolate, then one ratelimit_dropped line, so a
 *     flood cannot become a log-volume lever
 *
 * Drives the real worker.js fetch handler, route by route, with a limiter that denies, one that
 * throws and one that answers nonsense. Global fetch is stubbed so nothing leaves the machine.
 *
 *   node test/ratelimit.test.js
 *   node test/ratelimit.test.js --self-test   (re-run against broken copies; each break must be caught)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SELF = process.argv.includes('--self-test');
const ROOT = path.join(__dirname, '..');
const say = console.log.bind(console);
const HOST = 'https://little-cubby.com';
const IP = '203.0.113.9';

/* A D1 that answers everything with nothing, so the game routes get as far as their limiter. */
const fakeDb = () => {
  const sql = [];
  const stmt = (q) => { const st = { bind() { return st; }, run: async () => ({ success: true }),
    // RETURNING n hands out a page-stats slot, so the 404 counter does not think the day is full.
    first: async () => (/RETURNING n/.test(q) ? { n: 1 } : null), all: async () => ({ results: [] }) }; return st; };
  return { sql, prepare(q) { sql.push(q); return stmt(q); }, batch: async () => [] };
};

/* Each limited route: how to reach its limiter, which binding it uses, and the tag its log line names. */
const same = { origin: HOST, 'content-type': 'application/json', 'CF-Connecting-IP': IP };
const ROUTES = [
  { tag: 'signin_link', binding: 'SIGNIN_RATE_LIMITER', req: () => new Request(HOST + '/api/send-signin-link', { method: 'POST', headers: same, body: '{}' }) },
  { tag: 'signin_code', binding: 'SIGNIN_RATE_LIMITER', req: () => new Request(HOST + '/api/signin-code', { method: 'POST', headers: same, body: '{}' }) },
  { tag: 'signin_verify', binding: 'SIGNIN_RATE_LIMITER', req: () => new Request(HOST + '/api/signin-verify', { method: 'POST', headers: same, body: '{}' }) },
  { tag: 'invite_peek', binding: 'SIGNIN_RATE_LIMITER', req: () => new Request(HOST + '/api/invite-peek?t=abcdefghijklmnop1234', { headers: { 'CF-Connecting-IP': IP } }) },
  { tag: 'invite_send', binding: 'SIGNIN_RATE_LIMITER', req: () => new Request(HOST + '/api/send-invite', { method: 'POST', headers: same, body: '{}' }) },
  { tag: 'newsletter', binding: 'NEWSLETTER_RATE_LIMITER', req: () => new Request(HOST + '/api/newsletter', { method: 'POST', headers: same, body: '{}' }) },
  { tag: 'step', binding: 'STEP_RATE_LIMITER', req: () => new Request(HOST + '/api/step', { method: 'POST', headers: same, body: '{}' }) },
  { tag: 'dose', binding: 'DOSE_RATE_LIMITER', req: () => new Request(HOST + '/api/dose', { method: 'POST', headers: same, body: '{"n":"v1.not.real"}' }) },
  { tag: 'game_gcreate', binding: 'GAMES_RATE_LIMITER', db: true, req: () => new Request(HOST + '/api/game/create', { method: 'POST', headers: same, body: '{}' }) },
  { tag: 'game_guess', binding: 'GAMES_RATE_LIMITER', db: true, req: () => new Request(HOST + '/api/game/abcd1234/guess', { method: 'POST', headers: same, body: '{}' }) },
  { tag: 'game_hcreate', binding: 'GAMES_RATE_LIMITER', db: true, req: () => new Request(HOST + '/api/hub/create', { method: 'POST', headers: same, body: '{}' }) }
];

const LIMITERS = {
  deny: () => ({ limit: async () => ({ success: false }) }),
  allow: () => ({ limit: async () => ({ success: true }) }),
  throws: () => ({ limit: async ({ key }) => { throw new Error('limiter backend unavailable for ' + key); } }),
  nonsense: () => ({ limit: async ({ key }) => ({ echo: key }) })
};

/* One request through the real handler, with outbound fetch stubbed and the Worker's logs captured. */
async function drive(mod, route, kind) {
  const logs = [], keys = [];
  const realFetch = globalThis.fetch, realLog = console.log, realErr = console.error, realWarn = console.warn;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => 'stubbed' });
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  console.warn = (...a) => logs.push(a.join(' '));
  const lim = LIMITERS[kind]();
  const inner = lim.limit;
  lim.limit = async (o) => { keys.push(o && o.key); return inner(o); };
  const env = { ASSETS: { fetch: async () => new Response('<!doctype html><title>Not found</title>', { status: 404, headers: { 'content-type': 'text/html' } }) }, [route.binding]: lim };
  if (route.db) env.GAMES_DB = fakeDb();
  const later = [];
  let status;
  try {
    const res = await mod.default.fetch(route.req(), env, { waitUntil(p) { later.push(p); } });
    status = res.status;
    await Promise.allSettled(later);
  }
  catch (e) { status = 'threw:' + ((e && e.message) || e); }
  finally { globalThis.fetch = realFetch; console.log = realLog; console.error = realErr; console.warn = realWarn; }
  const counted = !!(env.GAMES_DB && env.GAMES_DB.sql && env.GAMES_DB.sql.some((q) => /INSERT INTO page_stats \(/.test(q)));
  return { status, logs, keys, counted };
}

async function suite(mod, src, quiet) {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => {
    if (c) { pass++; if (!quiet) say('  ok   ' + n); }
    else { fail++; if (!quiet) say('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); }
  };
  const head = (s) => { if (!quiet) say('\n' + s); };
  const has = (logs, word, tag) => logs.some((l) => l.split(/\s+/)[0] === word && l.split(/\s+/)[1] === tag);
  const rlLines = (logs) => logs.filter((l) => /^ratelimit_/.test(l));
  const leaks = (logs) => rlLines(logs).filter((l) => l.includes(IP));

  head('1. a limiter that says no gets a 429, on every route (control: the fake reaches each limiter)');
  for (const r of ROUTES) {
    const x = await drive(mod, r, 'deny');
    ok(r.tag + ': 429', x.status === 429, x.status);
    ok(r.tag + ': the limiter was asked, keyed by IP', x.keys.length >= 1 && x.keys.every((k) => typeof k === 'string' && k.endsWith(IP)), x.keys);
    ok(r.tag + ': and the denial is logged, so production can show it ever happens', has(x.logs, 'ratelimit_deny', r.tag), x.logs);
    ok(r.tag + ': without the key or the IP', leaks(x.logs).length === 0, leaks(x.logs));
  }

  head('2. a limiter that THROWS lets the request through, and says so');
  for (const r of ROUTES) {
    const x = await drive(mod, r, 'throws');
    ok(r.tag + ': not blocked (fail open is the policy)', x.status !== 429, x.status);
    ok(r.tag + ': ratelimit_throw logged with the route', has(x.logs, 'ratelimit_throw', r.tag), x.logs);
    ok(r.tag + ': but not the error text, which here carries the key and the IP', leaks(x.logs).length === 0
       && !rlLines(x.logs).some((l) => l.includes('backend unavailable')), rlLines(x.logs));
  }

  head('3. a limiter that answers without a boolean `success` lets the request through, and says so');
  for (const r of ROUTES) {
    const x = await drive(mod, r, 'nonsense');
    ok(r.tag + ': not blocked', x.status !== 429, x.status);
    ok(r.tag + ': ratelimit_shape logged', has(x.logs, 'ratelimit_shape', r.tag), x.logs);
    ok(r.tag + ': but not the reply, which here echoes the key', leaks(x.logs).length === 0, leaks(x.logs));
  }

  head('3b. the 404 page-view counter fails CLOSED: no count unless the limiter positively allows');
  {
    const PV = { tag: 'page_view', binding: 'PAGE_RATE_LIMITER', db: true, req: () => new Request(HOST + '/no-such-page', { headers: { 'CF-Connecting-IP': IP } }) };
    let x = await drive(mod, PV, 'allow');
    ok('page_view: an allow counts the 404 (control: the fake reaches the counter)', x.counted && x.keys.length === 1 && x.keys[0] === 'pv:' + IP, [x.counted, x.keys]);
    ok('page_view: and logs nothing', !x.logs.some((l) => /^ratelimit_/.test(l)), x.logs);
    x = await drive(mod, PV, 'deny');
    ok('page_view: a denial does not count', !x.counted);
    ok('page_view: and is logged', has(x.logs, 'ratelimit_deny', 'page_view'), x.logs);
    x = await drive(mod, PV, 'throws');
    ok('page_view: a throw does not count (fail closed)', !x.counted);
    ok('page_view: and is logged', has(x.logs, 'ratelimit_throw', 'page_view'), x.logs);
    x = await drive(mod, PV, 'nonsense');
    ok('page_view: a nonsense reply does not count', !x.counted);
    ok('page_view: and is logged', has(x.logs, 'ratelimit_shape', 'page_view'), x.logs);
    ok('page_view: the visitor still gets the page either way', x.status === 404, x.status);
    ok('page_view: no line carries the key or the network', leaks(x.logs).length === 0, leaks(x.logs));
    x = await drive(mod, PV, 'throws');
    ok('page_view: not even the error text of a throw', leaks(x.logs).length === 0, leaks(x.logs));
  }

  head('4. a limiter that allows is silent (no log line per request)');
  for (const r of ROUTES) {
    const x = await drive(mod, r, 'allow');
    ok(r.tag + ': not blocked and no ratelimit_ line', x.status !== 429 && !x.logs.some((l) => /^ratelimit_/.test(l)), [x.status, x.logs.filter((l) => /^ratelimit_/.test(l))]);
  }

  head('4b. a flood cannot become a log-volume lever (clock pinned to 2026-01-15 12:00:30Z)');
  {
    const realNow = Date.now;
    const T0 = Date.UTC(2026, 0, 15, 12, 0, 30);
    const PEEK = ROUTES.find((r) => r.tag === 'invite_peek'), DOSE = ROUTES.find((r) => r.tag === 'dose');
    try {
      Date.now = () => T0;
      let lines = [];
      for (let i = 0; i < 20; i++) lines = lines.concat(rlLines((await drive(mod, PEEK, 'deny')).logs));
      const denyLines = lines.filter((l) => l.startsWith('ratelimit_deny invite_peek'));
      ok('20 denials in one minute log at most 5 lines', denyLines.length >= 1 && denyLines.length <= 5, denyLines.length);
      let thr = [];
      for (let i = 0; i < 20; i++) thr = thr.concat(rlLines((await drive(mod, DOSE, 'throws')).logs));
      ok('20 throws in one minute log at most 5 lines', thr.filter((l) => l.startsWith('ratelimit_throw dose')).length <= 5, thr.length);
      Date.now = () => T0 + 60000;
      const next = rlLines((await drive(mod, PEEK, 'deny')).logs);
      const dropped = next.find((l) => l.startsWith('ratelimit_dropped ratelimit_deny invite_peek '));
      ok('the next minute says how many were dropped, and nothing else', !!dropped && /^ratelimit_dropped ratelimit_deny invite_peek \d+$/.test(dropped)
         && Number(dropped.split(' ').pop()) === 20 - denyLines.length, next);
      ok('and logs the new denial again', next.some((l) => l === 'ratelimit_deny invite_peek'), next);
    } finally { Date.now = realNow; }
  }

  head('5. there is exactly one way to ask a limiter');
  {
    const calls = (src.match(/\.limit\(/g) || []).length;
    ok('worker.js calls .limit( exactly once', calls === 1, calls);
    const at = src.indexOf('async function rateLimited(');
    const end = at >= 0 ? src.indexOf('\n}\n', at) : -1;
    const body = at >= 0 && end > at ? src.slice(at, end) : '';
    ok('and that one call is inside rateLimited()', !!body && body.includes('.limit('));
    ok('every *_RATE_LIMITER use goes to rateLimited (no other code touches a limiter)',
       !/RATE_LIMITER\s*\.\s*limit/.test(src.replace(body, '')));
  }
  return { pass, fail };
}

(async () => {
  say('\nrate limiters: deny, throw, nonsense, allow, on every limited route');
  const SRC = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
  const real = await import('file://' + path.join(ROOT, 'worker.js'));
  const r = await suite(real, SRC, false);
  let pass = r.pass, fail = r.fail;
  const ok = (n, c, x) => { if (c) { pass++; say('  ok   ' + n); } else { fail++; say('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };

  say('\n6. the wiring');
  {
    const gates = fs.readFileSync(path.join(ROOT, 'tools', 'gates.js'), 'utf8');
    ok('tools/gates.js runs this file with --self-test', /cmd: \['node', 'test\/ratelimit\.test\.js', '--self-test'\]/.test(gates));
  }

  if (SELF) {
    say('\n7. --self-test: each break is caught');
    const BASE = SRC.replace("from './workers/funnel/core.mjs'", "from '" + 'file://' + path.join(ROOT, 'workers', 'funnel', 'core.mjs') + "'");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratelimit-'));
    const MUTANTS = [
      ['a throw is swallowed silently again', "catch (e) { _rlLog('ratelimit_throw', where); return unavailable; }", 'catch (e) { return unavailable; }'],
      ['a throw fails CLOSED everywhere (blocks the parent)', "catch (e) { _rlLog('ratelimit_throw', where); return unavailable; }", "catch (e) { _rlLog('ratelimit_throw', where); return true; }"],
      ['a nonsense reply is not reported', "{ _rlLog('ratelimit_shape', where); return unavailable; }", '{ return unavailable; }'],
      ['the error text is logged again (it can carry the key)', "catch (e) { _rlLog('ratelimit_throw', where); return unavailable; }", "catch (e) { _rlLog('ratelimit_throw', where + ' ' + ((e && e.message) || '')); return unavailable; }"],
      ['the page-view counter fails open again', "'page_view', { failClosed: true })", "'page_view')"],
      ['a denial is ignored', 'return !r.success;', 'return false;'],
      ['the key goes into the log', "if (!r.success) _rlLog('ratelimit_deny', where);", "if (!r.success) _rlLog('ratelimit_deny', where + ' ' + key);"],
      ['the log is uncapped again', 'if (st.logged >= RL_LOG_PER_MIN) { st.dropped++; return; }', ''],
      ['a denial is not logged', "if (!r.success) _rlLog('ratelimit_deny', where);", ''],
      ['invite-peek goes back to its own silent try/catch', "if (await rateLimited(env.SIGNIN_RATE_LIMITER, 'peek:' + clientIpKey(request), 'invite_peek')) return json({ error: 'rate_limited' }, 429);",
        "try { const { success } = await env.SIGNIN_RATE_LIMITER.limit({ key: 'peek:' + clientIpKey(request) }); if (!success) return json({ error: 'rate_limited' }, 429); } catch (e) {}"],
      ['the game helper stops using rateLimited', "return rateLimited(env.GAMES_RATE_LIMITER || env.SIGNIN_RATE_LIMITER, bucket + ':' + clientIpKey(request), 'game_' + bucket);",
        "return false;"]
    ];
    let i = 0;
    for (const [name, find, repl] of MUTANTS) {
      if (!BASE.includes(find)) { ok('catches: ' + name + ' (anchor still present in worker.js)', false, find); continue; }
      const mutSrc = BASE.split(find).join(repl);
      const file = path.join(dir, 'worker-rl-' + (i++) + '.mjs');
      fs.writeFileSync(file, mutSrc);
      let caught = false;
      try { const m = await import('file://' + file); caught = (await suite(m, mutSrc, true)).fail > 0; }
      catch (e) { say('    (mutant failed to load: ' + (e && e.message) + ')'); }
      ok('catches: ' + name, caught);
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }

  say('\n' + pass + ' passed, ' + fail + ' failed');
  say(fail ? 'RATELIMIT: FAIL' : 'RATELIMIT: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
