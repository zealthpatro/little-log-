/* The 404 counter must never be able to spend the family database's write quota.
 *
 *   node test/page-stats.test.js
 *
 * Every request that reaches the Worker's fall-through (any unmatched path, so any 404) used to mint a
 * service-account token and commit to Firestore pageStats/{day}_{hex(path)}: one write per anonymous
 * GET, on a free plan whose 20k writes a day are shared with every family's feeds and doses, and one
 * new document per distinct path. This drives the REAL router with a mocked env and watches what it
 * actually asked for. Firestore is a recorder that answers 200 to everything, so the old code would
 * succeed at every write and the count below is honest. D1 is real SQLite (node:sqlite), so the upsert
 * runs as written.
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { generateKeyPairSync, randomBytes } = require('crypto');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + JSON.stringify(detail).slice(0, 400) : '')); }
};

/* D1 over real SQLite, counting every statement it is asked to run (inside a batch too). */
function makeD1(opts) {
  opts = opts || {};
  const db = new DatabaseSync(':memory:');
  const stats = { statements: 0 };
  const prepare = (sql) => {
    let args = [];
    const go = (fn) => { stats.statements++; if (opts.broken) throw new Error('d1 down'); return fn(); };
    const st = {
      bind: (...a) => { args = a; return st; },
      run: async () => go(() => { db.prepare(sql).run(...args); return { success: true }; }),
      first: async () => go(() => { const r = db.prepare(sql).get(...args); return r ? Object.assign({}, r) : null; }),
      all: async () => go(() => ({ results: db.prepare(sql).all(...args).map((r) => Object.assign({}, r)) })),
    };
    return st;
  };
  return { prepare, batch: async (sts) => { for (const s of sts) await s.run(); return []; }, raw: db, stats };
}
const tableRows = (d1) => {
  try { return d1.raw.prepare('SELECT * FROM page_stats').all().map((r) => Object.assign({}, r)); } catch (e) { return []; }
};
const totalCounted = (d1) => tableRows(d1).reduce((s, r) => s + Number(r.n || 0), 0);

/* A per-key limiter shaped like the Workers ratelimit binding: `limit` per key, then refuse. */
function makeLimiter(limit) {
  const seen = new Map();
  return { keys: seen, limit: async ({ key }) => { const n = (seen.get(key) || 0) + 1; seen.set(key, n); return { success: n <= limit }; } };
}

/* The static-assets binding: two real pages, and the branded 404 page for everything else. */
const KNOWN = new Set(['/articles/known-page/', '/pricing/']);
const ASSETS = {
  fetch: async (req) => {
    const p = new URL(req.url).pathname;
    if (KNOWN.has(p)) return new Response('<p>page</p>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response('<p>not found</p>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
  },
};

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({ project_id: 'little-log-a9caa', client_email: 'x@y.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });

/* Every outbound request the Worker makes. Google answers 200, so a write would really "land". */
const outbound = [];
globalThis.fetch = async (url) => {
  url = String(url); outbound.push(url);
  const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.indexOf('oauth2.googleapis.com') >= 0) return j({ access_token: 'tok' });
  return j({});
};
const googleCalls = () => outbound.filter((u) => /googleapis\.com/.test(u)).length;

const rnd = () => randomBytes(8).toString('hex');
/* What a stranger would send: random roots, random paths under real sections, scanner probes, deep and
   long paths, and query strings carrying something secret-shaped. */
function randomPath(i) {
  const r = rnd();
  switch (i % 8) {
    case 0: return '/' + r;
    case 1: return '/articles/' + r + '/';
    case 2: return '/app/' + r + '?oobCode=SECRET' + r;
    case 3: return '/wp-admin/' + r + '.php';
    case 4: return '/' + r + '/' + r + '/' + r + '/' + r;
    case 5: return '/' + 'a'.repeat(150) + r;
    case 6: return '/g/' + r;
    default: return '/assets/' + r + '.png';
  }
}

(async () => {
  const mod = await import('file://' + path.join(__dirname, '..', 'worker.js'));
  const worker = mod.default;

  /* One GET through the real router, waiting for whatever it handed to waitUntil. */
  async function get(env, p, headers, method) {
    const pending = [];
    const ctx = { waitUntil: (pr) => pending.push(Promise.resolve(pr).catch((e) => { pending.err = e; })) };
    const res = await worker.fetch(new Request('https://little-cubby.com' + p, { method: method || 'GET', headers: headers || {} }), env, ctx);
    await Promise.all(pending);
    return { res, err: pending.err };
  }
  const baseEnv = (extra) => Object.assign({ ASSETS, FIREBASE_SERVICE_ACCOUNT: SA }, extra);

  console.log('\npage stats: anonymous 404 traffic and the family database\n');

  console.log('1. a thousand random 404s from one address');
  let d1 = makeD1(); let lim = makeLimiter(30);
  let env = baseEnv({ GAMES_DB: d1, PAGE_RATE_LIMITER: lim });
  outbound.length = 0;
  let served404 = 0, bodyOk = 0, threw = 0;
  const random = [];
  for (let i = 0; i < 1000; i++) {
    const p = randomPath(i); random.push(p);
    const { res, err } = await get(env, p, { 'CF-Connecting-IP': '203.0.113.7' });
    if (res.status === 404) served404++;
    if ((await res.text()).indexOf('not found') >= 0) bodyOk++;
    if (err) threw++;
  }
  ok('every one of them is still served the 404 page', served404 === 1000 && bodyOk === 1000, { served404, bodyOk });
  ok('ZERO requests reached Firestore or Google OAuth', googleCalls() === 0, { googleCalls: googleCalls(), sample: outbound.slice(0, 2) });
  ok('nothing thrown out of waitUntil', threw === 0, threw);
  ok('D1 statements are bounded by the per-address throttle, not by the request count', d1.stats.statements <= 40, d1.stats.statements);
  ok('at most 30 of them were counted', totalCounted(d1) <= 30, totalCounted(d1));

  console.log('\n2. a thousand random 404s from a thousand addresses');
  d1 = makeD1(); lim = makeLimiter(30);
  env = baseEnv({ GAMES_DB: d1, PAGE_RATE_LIMITER: lim });
  outbound.length = 0;
  for (let i = 0; i < 1000; i++) {
    await get(env, random[i], { 'CF-Connecting-IP': '198.51.' + Math.floor(i / 250) + '.' + (i % 250) });
  }
  let rows = tableRows(d1);
  const keys = [...new Set(rows.map((r) => r.path))];
  ok('ZERO requests reached Firestore or Google OAuth', googleCalls() === 0, googleCalls());
  /* /g/<code> is routed to the guest page before the fall-through, so it never reaches the counter. */
  const reachable = random.filter((p) => !/^\/g\//.test(p)).length;
  ok('every request that reaches the counter was counted (the throttle is per address)', reachable > 800 && totalCounted(d1) === reachable, { counted: totalCounted(d1), reachable });
  ok('but they landed in a small fixed set of buckets, not one row per path', keys.length > 0 && keys.length <= 12, keys);
  ok('a write is one statement per counted request, plus schema setup', d1.stats.statements <= 1000 + 5, d1.stats.statements);
  const stored = JSON.stringify(rows).toLowerCase();
  ok('no random path segment was stored', rows.length > 0 && random.every((p) => { const m = p.match(/[0-9a-f]{16}/); return !m || stored.indexOf(m[0]) < 0; }), keys);
  ok('no query string or secret was stored', rows.length > 0 && stored.indexOf('oobcode') < 0 && stored.indexOf('secret') < 0 && stored.indexOf('?') < 0, keys);

  console.log('\n3. one IPv6 household rotating through its /64');
  d1 = makeD1(); lim = makeLimiter(30);
  env = baseEnv({ GAMES_DB: d1, PAGE_RATE_LIMITER: lim });
  for (let i = 0; i < 200; i++) {
    await get(env, '/' + rnd(), { 'CF-Connecting-IP': '2001:db8:aa:bb:' + i.toString(16) + ':' + rnd().slice(0, 4) + ':1:2' });
  }
  ok('is throttled as one address', totalCounted(d1) <= 30, totalCounted(d1));

  console.log('\n4. a normal page view increments its bucket');
  d1 = makeD1(); lim = makeLimiter(30);
  env = baseEnv({ GAMES_DB: d1, PAGE_RATE_LIMITER: lim });
  outbound.length = 0;
  let r = await get(env, '/articles/known-page/', { 'CF-Connecting-IP': '192.0.2.1' });
  ok('the page is served with 200', r.res.status === 200, r.res.status);
  rows = tableRows(d1);
  const okRow = rows.find((x) => x.cls === 'ok');
  ok('one ok row under its section bucket', rows.length === 1 && okRow && okRow.n === 1 && /^\/articles/.test(okRow.path), rows);
  await get(env, '/articles/known-page/', { 'CF-Connecting-IP': '192.0.2.1' });
  rows = tableRows(d1);
  ok('a second view is the same row with n = 2, an atomic upsert', rows.length === 1 && rows[0].n === 2, rows);
  await get(env, '/app/missing-thing', { 'CF-Connecting-IP': '192.0.2.1' });
  const appRow = tableRows(d1).find((x) => x.cls === 'n404');
  ok('a broken /app/ link is a 404 under the /app bucket', appRow && /^\/app/.test(appRow.path) && appRow.n === 1, tableRows(d1));
  ok('and the day is the UTC day, nothing finer', tableRows(d1).length > 0 && tableRows(d1).every((x) => x.day === new Date().toISOString().slice(0, 10)), tableRows(d1));
  ok('the table has no column that could hold a person', !!rows[0] && Object.keys(rows[0]).sort().join(',') === 'cls,day,n,path', rows[0] && Object.keys(rows[0]));
  ok('still zero Firestore requests', googleCalls() === 0, googleCalls());

  console.log('\n5. a refused or broken throttle means no count, never a failed page');
  d1 = makeD1();
  env = baseEnv({ GAMES_DB: d1, PAGE_RATE_LIMITER: { limit: async () => ({ success: false }) } });
  r = await get(env, '/' + rnd(), { 'CF-Connecting-IP': '192.0.2.2' });
  ok('over the limit: served, not counted', r.res.status === 404 && totalCounted(d1) === 0, totalCounted(d1));
  env = baseEnv({ GAMES_DB: d1, PAGE_RATE_LIMITER: { limit: async () => { throw new Error('limiter down'); } } });
  r = await get(env, '/' + rnd(), { 'CF-Connecting-IP': '192.0.2.2' });
  ok('limiter throws: served, not counted', r.res.status === 404 && totalCounted(d1) === 0 && !r.err, totalCounted(d1));
  env = baseEnv({ GAMES_DB: d1 });
  r = await get(env, '/' + rnd(), { 'CF-Connecting-IP': '192.0.2.2' });
  ok('no limiter bound at all: served, not counted (an unthrottled counter is not safe to run)', r.res.status === 404 && totalCounted(d1) === 0, totalCounted(d1));

  console.log('\n6. D1 down or missing never breaks serving and never falls back to Firestore');
  outbound.length = 0;
  env = baseEnv({ GAMES_DB: makeD1({ broken: true }), PAGE_RATE_LIMITER: makeLimiter(30) });
  r = await get(env, '/' + rnd(), { 'CF-Connecting-IP': '192.0.2.3' });
  ok('broken D1: still 404, nothing thrown', r.res.status === 404 && !r.err, r.err && String(r.err));
  env = baseEnv({ PAGE_RATE_LIMITER: makeLimiter(30) });
  r = await get(env, '/' + rnd(), { 'CF-Connecting-IP': '192.0.2.3' });
  ok('no D1 bound: still 404, nothing thrown', r.res.status === 404 && !r.err);
  ok('and neither one reached Firestore', googleCalls() === 0, googleCalls());

  console.log('\n7. only HTML GETs are counted');
  d1 = makeD1();
  env = baseEnv({ GAMES_DB: d1, PAGE_RATE_LIMITER: makeLimiter(30) });
  await get(env, '/' + rnd(), { 'CF-Connecting-IP': '192.0.2.4' }, 'HEAD');
  await get(env, '/' + rnd(), { 'CF-Connecting-IP': '192.0.2.4' }, 'POST');
  ok('HEAD and POST are not counted', totalCounted(d1) === 0, tableRows(d1));
  /* Paired with the line above, so it cannot pass on a counter that counts nothing. */
  await get(env, '/' + rnd(), { 'CF-Connecting-IP': '192.0.2.4' });
  ok('and a GET on the same env is', totalCounted(d1) === 1, tableRows(d1));

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
