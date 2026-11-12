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

/* D1 over real SQLite, counting every statement it is asked to run (inside a batch too), and the rows
   each write changed. With opts.writeBudget it behaves like D1's free plan once the day's rows-written
   allowance is spent: every further write fails, whoever sent it. */
function makeD1(opts) {
  opts = opts || {};
  const db = new DatabaseSync(':memory:');
  const stats = { statements: 0, rowsWritten: 0 };
  const prepare = (sql) => {
    let args = [];
    const isWrite = /^\s*(insert|update|delete|replace)\b/i.test(sql);
    const go = (fn) => {
      stats.statements++;
      if (opts.broken) throw new Error('d1 down');
      if (isWrite && opts.writeBudget != null && stats.rowsWritten >= opts.writeBudget) throw new Error('D1_ERROR: daily rows written limit exceeded');
      const out = fn();
      if (isWrite) stats.rowsWritten += Number(db.prepare('SELECT changes() AS c').get().c || 0);
      return out;
    };
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
  async function getW(w, env, p, headers, method) {
    const pending = [];
    const ctx = { waitUntil: (pr) => pending.push(Promise.resolve(pr).catch((e) => { pending.err = e; })) };
    const res = await w.fetch(new Request('https://little-cubby.com' + p, { method: method || 'GET', headers: headers || {} }), env, ctx);
    await Promise.all(pending);
    return { res, err: pending.err };
  }
  const get = (...a) => getW(worker, ...a);
  /* A fresh copy of worker.js is a fresh isolate: its module-level state starts empty. */
  let isolates = 0;
  const freshWorker = async () => (await import('file://' + path.join(__dirname, '..', 'worker.js') + '?isolate=' + (++isolates))).default;
  /* Pin the clock, DAY included (two gates here flaked on month boundaries). Only new Date() / Date.now()
     move; everything else is the real Date. */
  const RealDate = Date;
  const pinClock = (iso) => {
    const t = RealDate.parse(iso);
    globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(t); } static now() { return t; } };
  };
  const unpinClock = () => { globalThis.Date = RealDate; };
  /* Capture what the Worker logs, so "logs once" is checked rather than assumed. */
  const logged = [];
  const realLog = console.log, realWarn = console.warn, realErr = console.error;
  const capture = () => { logged.length = 0; const f = (...a) => logged.push(a.map(String).join(' ')); console.log = f; console.warn = f; console.error = f; };
  const release = () => { console.log = realLog; console.warn = realWarn; console.error = realErr; };
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
  // Two statements per counted view (the daily total, then the bucket), plus schema setup.
  ok('D1 statements are bounded by the per-address throttle, not by the request count', d1.stats.statements <= 2 * 30 + 5, d1.stats.statements);
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
  ok('a write is two statements per counted request (total, bucket), plus schema setup', d1.stats.statements <= 2 * reachable + 5, { statements: d1.stats.statements, reachable });
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

  /* Round 2. Per-address throttling bounds one address, not the total. 500 /64s inside one /48 (what a
     free tunnel hands out) or a few IPv4 addresses could still spend the cubby-games D1's daily writes,
     and that D1 also holds account-deletion cleanup, the guest guessing game and the cron heartbeat. */
  console.log('\n8. a flood from 500 /64s inside one /48 plus eight IPv4 addresses, with a daily cap of 50');
  const CAP = 50;
  d1 = makeD1({ writeBudget: 400 });
  // Someone's guessing-game hub, there before the flood. Deleting their account must still remove it.
  d1.raw.exec("CREATE TABLE hubs (code TEXT PRIMARY KEY, owner_uid TEXT, title TEXT, created_at INTEGER)");
  d1.raw.prepare("INSERT INTO hubs (code, owner_uid, title, created_at) VALUES ('hubcode1', 'uid-leaving', 'Our bump', 1)").run();
  lim = makeLimiter(30);
  env = baseEnv({ GAMES_DB: d1, PAGE_RATE_LIMITER: lim, PAGE_STATS_DAILY_CAP: String(CAP) });
  pinClock('2026-11-12T10:00:00Z');
  let w = await freshWorker();
  outbound.length = 0;
  let floodReqs = 0, flood404 = 0, floodThrew = 0, statementsAtCap = -1;
  capture();
  try {
    const ips = [];
    for (let s = 0; s < 500; s++) ips.push('2001:470:abcd:' + s.toString(16) + '::1');
    for (let a = 0; a < 8; a++) ips.push('198.51.100.' + (10 + a));
    for (const ip of ips) {
      for (let i = 0; i < 31; i++) {
        const { res, err } = await getW(w, env, '/x' + i, { 'CF-Connecting-IP': ip });
        floodReqs++; if (res.status === 404) flood404++; if (err) floodThrew++;
        if (statementsAtCap < 0 && totalCounted(d1) >= CAP) statementsAtCap = d1.stats.statements;
      }
    }
  } finally { release(); }
  const capLogs = logged.filter((l) => /pagestats_cap/.test(l));
  ok('every request was still served the 404 page', flood404 === floodReqs && floodReqs === 508 * 31 && floodThrew === 0, { floodReqs, flood404, floodThrew });
  ok('counting stopped at the cap: page-stat counts never exceed it', totalCounted(d1) === CAP, { counted: totalCounted(d1), cap: CAP });
  ok('rows written for page stats stay within two per counted view', d1.stats.rowsWritten <= 1 + 2 * CAP + 2, { rowsWritten: d1.stats.rowsWritten });
  ok('once the cap is seen, this isolate stops calling D1 for page stats', statementsAtCap > 0 && d1.stats.statements - statementsAtCap <= 1, { statementsAtCap, statements: d1.stats.statements });
  ok('and says so once, not once per request', capLogs.length === 1, capLogs.slice(0, 3));
  ok('still zero Firestore requests', googleCalls() === 0, googleCalls());
  let purgeErr = null;
  try {
    // What purgeAccountData runs for a deleted account's hub, against the same D1 after the flood.
    await d1.prepare('DELETE FROM hubs WHERE code=?').bind('hubcode1').run();
  } catch (e) { purgeErr = String(e.message || e); }
  const hubLeft = d1.raw.prepare("SELECT COUNT(*) AS c FROM hubs WHERE owner_uid = 'uid-leaving'").get().c;
  ok('account-deletion cleanup on the same D1 still runs after the flood', purgeErr === null && hubLeft === 0, { purgeErr, hubLeft });

  console.log('\n9. another isolate on the same day finds the cap already reached');
  let w2 = await freshWorker();
  const before = d1.stats.statements, writtenBefore = d1.stats.rowsWritten;
  capture();
  try {
    for (let i = 0; i < 20; i++) await getW(w2, env, '/y' + i, { 'CF-Connecting-IP': '192.0.2.' + (50 + i) });
  } finally { release(); }
  ok('counts nothing more', totalCounted(d1) === CAP, totalCounted(d1));
  ok('writes no row', d1.stats.rowsWritten === writtenBefore, { before: writtenBefore, after: d1.stats.rowsWritten });
  ok('and asks D1 only once to learn it (schema setup aside)', d1.stats.statements - before <= 3, { statements: d1.stats.statements - before });

  console.log('\n10. the next UTC day counts again');
  pinClock('2026-11-13T00:00:30Z');
  await getW(w2, env, '/z', { 'CF-Connecting-IP': '192.0.2.99' });
  const tomorrow = tableRows(d1).filter((r) => r.day === '2026-11-13');
  ok('a view after midnight UTC is counted under the new day', tomorrow.length === 1 && tomorrow[0].n === 1, tomorrow);
  unpinClock();

  console.log('\n11. the cap defaults to 5000 when PAGE_STATS_DAILY_CAP is unset');
  pinClock('2026-11-12T10:00:00Z');
  d1 = makeD1();
  d1.raw.exec('CREATE TABLE page_stats_total (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)');
  d1.raw.prepare("INSERT INTO page_stats_total (day, n) VALUES ('2026-11-12', 4999)").run();
  env = baseEnv({ GAMES_DB: d1, PAGE_RATE_LIMITER: makeLimiter(30) });
  w = await freshWorker();
  capture();
  try { for (let i = 0; i < 3; i++) await getW(w, env, '/d' + i, { 'CF-Connecting-IP': '192.0.2.' + (120 + i) }); }
  finally { release(); }
  const totalRow = d1.raw.prepare("SELECT n FROM page_stats_total WHERE day = '2026-11-12'").get();
  ok('one more view fits under 5000, the next two do not', totalCounted(d1) === 1 && totalRow && totalRow.n === 5000, { counted: totalCounted(d1), total: totalRow });
  unpinClock();

  console.log('\n12. IPv6 is throttled per /48, whatever way the address is written');
  const keysFor = async (ipList) => {
    const l = makeLimiter(30);
    const e = baseEnv({ GAMES_DB: makeD1(), PAGE_RATE_LIMITER: l });
    for (const ip of ipList) await get(e, '/' + rnd(), { 'CF-Connecting-IP': ip });
    return [...l.keys.keys()];
  };
  let k = await keysFor(Array.from({ length: 500 }, (_, s) => '2001:470:abcd:' + s.toString(16) + '::1'));
  ok('500 /64s inside one /48 are one throttle key', k.length === 1, k.slice(0, 3));
  k = await keysFor(['2001:0:0:5::1', '2001::5:a:b:c:d', '2001:0000:0000:0005:0000:0000:0000:0001', '2001:0:0:9::1']);
  ok('2001:0:0:5::1 and 2001::5:a:b:c:d share a key (a compressed zero run no longer splits it)', k.length === 1, k);
  /* Paired with the two lines above, so a constant key cannot pass them. */
  k = await keysFor(['2001:db8:1::1', '2001:db8:2::1', '198.51.100.1', '::ffff:198.51.100.1']);
  ok('different /48s, and different IPv4 addresses, keep separate keys', k.length === 3, k);
  // The default (/64) is what the sign-in limiter uses; check it on the same compressed forms.
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
  const m = src.match(/\nfunction clientIpKey\([\s\S]*?\n}\n/);
  let cik = null; try { cik = m && new Function(m[0] + '; return clientIpKey;')(); } catch (e) { cik = null; }
  const req6 = (ip) => ({ headers: { get: () => ip } });
  ok('clientIpKey(request) keys a /64 the same however it is written, and a different /64 apart',
    !!cik && cik(req6('2001:0:0:5::1')) === cik(req6('2001::5:a:b:c:d')) && cik(req6('2001::5:a:b:c:d')) !== cik(req6('2001:0:0:6::1'))
      && cik(req6('2001:0:0:5::1'), 3) === cik(req6('2001:0:0:6::1'), 3),
    cik ? [cik(req6('2001:0:0:5::1')), cik(req6('2001::5:a:b:c:d')), cik(req6('2001:0:0:5::1'), 3)] : 'clientIpKey not found in worker.js');

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
