/* usage-route: the POST /api/usage route itself, through the REAL worker.js fetch handler over real SQLite.
 *
 *   node test/usage-route.test.js
 *   node test/usage-route.test.js --self-test   (break each rule in a temp copy of the tree; each must be caught)
 *
 * Spec §8.7 (S15, S22, S27) and §14 (usage-ingest's route half). What core.ingest() stores is
 * test/usage-ingest.test.js; this is everything around it: mode off answers before the body is read; the
 * 32 KB cap holds with and without a Content-Length, counted in bytes; 50 events; the limiter keyed per
 * person and per IP; a household claim is stamped only once the members map confirms it; past a ceiling
 * the route stops touching D1 for the rest of the UTC day; no log line names a person; and the membership
 * cache links nobody to a household before she has seen the notice (G4) and writes a bounded number of
 * rows (MEMB-BOUND). Google's token, JWK and Firestore endpoints are stubbed at fetch. The clock is pinned to
 * a day AND an hour: Monday 16 November 2026, 06:00 UTC, the same hour on the next two days for the
 * ceiling section, Thursday 19 November 2026 from 00:05 UTC for the membership section, and Saturday 21
 * November 2026 from 06:00 UTC to Sunday 22 November 00:10 UTC for the account purge's reach into the
 * membership memory: hers, and nobody else's (RE-SK-3, SE-V8).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const SELF = process.argv.includes('--self-test');

const HOST = 'https://little-cubby.com';
const PROJECT = 'little-log-a9caa';
const FS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const SA = { project_id: PROJECT, client_email: 'cubby@' + PROJECT + '.iam.gserviceaccount.com',
  private_key: nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey };
const idPair = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = Object.assign(idPair.publicKey.export({ format: 'jwk' }), { kid: 'test-kid', alg: 'RS256', use: 'sig' });
const b64u = (s) => Buffer.from(s).toString('base64url');
/* Minted on the pinned clock, so the worker's exp and iat checks see a fresh token. Kept per uid and second,
   so the self-test's many runs of section 9 (1,100 people) sign each token once. */
const minted = new Map();
function idToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const key = uid + '@' + now;
  if (!minted.has(key)) minted.set(key, mint(uid, now));
  return minted.get(key);
}
function mint(uid, now) {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ aud: PROJECT, iss: 'https://securetoken.google.com/' + PROJECT, sub: uid, iat: now - 5, exp: now + 3600 }));
  return head + '.' + body + '.' + nodeCrypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), idPair.privateKey).toString('base64url');
}

const ME = 'uidFounder000000000000000001', OTHER = 'uidOther0000000000000000002', STALE = 'uidStaleClaim00000000000003';
const EMAIL = 'zz-maya7731@example.com', PAD = 'ZZPAD7731';

/* The world outside our code: Firestore documents by path, and a count of reads. */
const docs = new Map();
let fsReads = 0;
const readsOf = new Map();   // Firestore reads by document path
const J = (o, s, h) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'content-type': 'application/json' }, h || {}) });
globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const method = ((init && init.method) || 'GET').toUpperCase();
  if (url.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 'tok', expires_in: 3600 });
  if (url === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') return J({ keys: [JWK] }, 200, { 'cache-control': 'max-age=3600' });
  // The account purge's feedback query (section 10): nobody here has a note.
  if (url === FS + ':runQuery' && method === 'POST') return J([]);
  if (url.startsWith(FS + '/') && method === 'GET') {
    fsReads++;
    const p = decodeURIComponent(url.slice(FS.length + 1).split('?')[0]);
    readsOf.set(p, (readsOf.get(p) || 0) + 1);
    return docs.has(p) ? J({ name: FS + '/' + p, fields: docs.get(p) }) : J({ error: { status: 'NOT_FOUND' } }, 404);
  }
  throw new Error('unstubbed external call: ' + method + ' ' + url);
};
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

const DAY1 = Date.UTC(2026, 10, 16, 6, 0, 0), DAYMS = 86400000;

/* `opts.ceiling` (default on): also run section 9, 1,100 people through the route (about two seconds). The
   plain run, the self-test's unaltered copy and the membership-ceiling break run it. */
async function suite(workerFile, quiet, opts) {
  const withCeiling = !opts || opts.ceiling !== false;
  let pass = 0, fail = 0;
  const realLog = console.log, realErr = console.error, realWarn = console.warn, realInfo = console.info;
  const ok = (n, c, x) => { if (c) pass++; else { fail++; if (!quiet) realLog('  FAIL ' + n + (x !== undefined ? '\n       ' + JSON.stringify(x).slice(0, 400) : '')); } };
  let w;
  try { w = (await import('file://' + workerFile + '?' + Math.random())).default; }
  catch (e) { return { pass, fail, loadError: String(e && e.message || e) }; }
  const { makeD1 } = await import('file://' + path.join(ROOT, 'workers', 'admin', 'dev', 'd1-sqlite.mjs'));
  const schema = fs.readFileSync(path.join(ROOT, 'schema', 'usage.sql'), 'utf8');
  /* A D1 over real SQLite that counts its calls (each first/run/all, each batch). */
  const metered = (opts) => {
    const raw = makeD1(opts); raw.raw.exec(schema);
    const m = { calls: 0, raw };
    const wrap = (s) => Object.assign({}, s, { bind: (...a) => wrap(s.bind(...a)), first: (...x) => { m.calls++; return s.first(...x); }, run: (...x) => { m.calls++; return s.run(...x); }, all: (...x) => { m.calls++; return s.all(...x); } });
    m.db = { prepare: (sql) => wrap(raw.prepare(sql)), batch: (list) => { m.calls++; return raw.batch(list); } };
    m.count = (t, where) => raw.raw.prepare('SELECT COUNT(*) AS c FROM ' + t + (where ? ' WHERE ' + where : '')).get().c;
    m.rows = (sql) => raw.raw.prepare(sql).all();
    return m;
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  /* The console recorder (S15): every line any console method prints while the suite runs. */
  const lines = [];
  const rec = (kind) => (...a) => lines.push(kind + ' ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  console.log = rec('log'); console.error = rec('error'); console.warn = rec('warn'); console.info = rec('info');
  const realNow = Date.now;
  let clock = DAY1;
  Date.now = () => clock;
  const SECRETS = [ME, OTHER, STALE, EMAIL, PAD];
  const leaks = (ls) => ls.filter((l) => SECRETS.some((s) => l.includes(s)));

  const send = async (env, body, headers) => {
    const init = { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', Origin: HOST }, headers || {}) };
    if (body instanceof ReadableStream) { init.body = body; init.duplex = 'half'; } else init.body = typeof body === 'string' ? body : JSON.stringify(body);
    const r = await w.fetch(new Request(HOST + '/api/usage', init), env, ctx);
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j };
  };
  /* A body that counts how many chunks the worker pulled. highWaterMark 0: nothing is pulled until asked. */
  const stream = (chunks) => {
    const s = { pulls: 0 };
    s.body = new ReadableStream({ pull(c) { if (s.pulls >= chunks.length) { c.close(); return; } c.enqueue(chunks[s.pulls++]); } }, { highWaterMark: 0 });
    return s;
  };
  const filler = (n) => new Uint8Array(n).fill(0x61);
  let k = 0;
  const ev = (name, props) => { k++; return { id: '6f1c0b8e-0000-4000-8000-' + k.toString(16).padStart(12, '0'), t: Date.now() - 1000, visit: 'v_abcd1234', name, props }; };
  const batch = (events, extra) => Object.assign({ v: 1, tz: 'Asia/Dubai', device: 'd_k3j9x2m7q1aa', platform: 'browser', app_version: 'v368', events }, extra || {});
  const home = () => ev('screen.viewed', { screen: 'home' });
  const bearer = (uid) => ({ Authorization: 'Bearer ' + idToken(uid) });
  const allow = () => { const l = { keys: [], deny: false, throws: false }; l.limit = async ({ key }) => { l.keys.push(key); if (l.throws) throw new Error('limiter down for ' + key + ' ' + ME); return { success: !l.deny }; }; return l; };
  const SAJ = JSON.stringify(SA);

  docs.clear(); readsOf.clear();   // every run starts from an empty world: the self-test runs this many times
  docs.set('users/' + ME, { householdId: { stringValue: 'hhMine01' }, privacyNoticeSeen: { stringValue: 'n2' }, email: { stringValue: EMAIL } });
  docs.set('households/hhMine01', { members: { mapValue: { fields: { [ME]: { stringValue: 'owner' } } } } });
  // A caregiver removed from hhMine01: her own users doc still CLAIMS it, the members map no longer has her.
  docs.set('users/' + STALE, { householdId: { stringValue: 'hhMine01' }, privacyNoticeSeen: { stringValue: 'n2' } });

  try {
    // 1. Mode off, or no database: answered before a single byte of the body is read (W7). Production ships off.
    {
      const m = metered();
      for (const [label, env] of [['mode off', { USAGE_DB: m.db, USAGE_MODE: 'off' }], ['no database bound', { USAGE_MODE: 'internal', INTERNAL_UIDS: ME }], ['no mode set', { USAGE_DB: m.db }]]) {
        const s = stream(Array.from({ length: 40 }, () => filler(16384)));
        const r = await send(env, s.body, bearer(ME));
        ok(label + ': answers off without reading the body (' + s.pulls + ' chunks pulled)', r.status === 200 && r.body && r.body.mode === 'off' && s.pulls === 0, { r, pulls: s.pulls });
      }
      ok('and touches no D1', m.calls === 0, m.calls);
      const r3 = await send({ USAGE_DB: m.db, USAGE_MODE: 'off' }, batch([home()]), { Origin: 'https://evil.example' });
      ok('another origin is a 403, in any mode', r3.status === 403, r3);
    }

    // 2. The 32 KB cap (§8.7, S27), with a Content-Length, without one, and counted in bytes.
    {
      const m = metered();
      const env = { USAGE_DB: m.db, USAGE_MODE: 'internal', INTERNAL_UIDS: ME, FIREBASE_SERVICE_ACCOUNT: SAJ };
      const s1 = stream(Array.from({ length: 40 }, () => filler(16384)));
      const r1 = await send(env, s1.body, Object.assign({ 'content-length': String(40 * 16384) }, bearer(ME)));
      ok('a Content-Length over 32 KB is a 413 before the body is read', r1.status === 413 && s1.pulls === 0, { r1, pulls: s1.pulls });
      const s2 = stream(Array.from({ length: 40 }, () => filler(16384)));
      const r2 = await send(env, s2.body, bearer(ME));
      ok('a 640 KB body with no Content-Length is a 413, and reading stops just past 32 KB (' + s2.pulls + ' of 40 chunks pulled)', r2.status === 413 && s2.pulls <= 4, { r2, pulls: s2.pulls });
      ok('companion: the same counter sees a read when the worker reads', s2.pulls > 0, s2.pulls);
      // 17,000 two-byte characters: 34,000 bytes, though only 17,000 UTF-16 units.
      const wide = JSON.stringify(batch([home()], { pad: 'é'.repeat(17000) }));
      const r3 = await send(env, wide, bearer(ME));
      ok('the cap counts bytes: 34 KB of two-byte characters (17,000 units) is a 413', r3.status === 413 && m.count('usage_events') === 0, r3);
      const sized = (bytes) => { const b = JSON.stringify(batch([home()], { pad: '' })); return JSON.stringify(batch([home()], { pad: 'a'.repeat(bytes - Buffer.byteLength(b)) })); };
      const at = sized(32768), over = sized(32769);
      ok('(the test bodies are 32,768 and 32,769 bytes)', Buffer.byteLength(at) === 32768 && Buffer.byteLength(over) === 32769);
      const r4 = await send(env, over, bearer(ME));
      ok('one byte over 32 KB is a 413', r4.status === 413, r4);
      const r5 = await send(env, at, bearer(ME));
      ok('companion: exactly 32 KB is accepted and stored', r5.status === 200 && r5.body.accepted === 1 && m.count('usage_events') === 1, r5);
      /* A streamed body, no Content-Length, cut in the middle of a two-byte character. Decoding each piece on
         its own would turn that character into two U+FFFD. Nothing ingest stores can show it (a character
         outside ASCII can only sit inside a JSON string, and every string ingest keeps from the body must
         match an ASCII pattern or list), so the text the route hands JSON.parse is recorded for this one
         request and checked itself. */
      const bytes = Buffer.from(JSON.stringify(batch([home()], { pad: 'éé' + PAD })));
      const cut = bytes.indexOf(Buffer.from('é')) + 1;
      const s6 = stream([bytes.subarray(0, cut), bytes.subarray(cut, cut + 7), bytes.subarray(cut + 7)].map((b) => new Uint8Array(b)));
      const parsed = [], realParse = JSON.parse;
      JSON.parse = function (text, ...rest) { if (typeof text === 'string' && text.includes(PAD)) parsed.push(text); return realParse.call(this, text, ...rest); };
      let r6;
      try { r6 = await send(env, s6.body, bearer(ME)); } finally { JSON.parse = realParse; }
      ok('a body streamed in pieces, cut inside a character, is accepted and stored', r6.status === 200 && r6.body.accepted === 1 && m.count('usage_events') === 2, { r6, pulls: s6.pulls });
      ok('and the text the route parses holds that character whole, with no U+FFFD', parsed.length === 1 && parsed[0].includes('"éé' + PAD + '"') && !parsed[0].includes('\uFFFD'), parsed.map((t) => t.slice(t.indexOf('pad') - 2, t.indexOf('pad') + 20)));
    }

    // 3. At most 50 events a batch, through the route.
    {
      const m = metered();
      const env = { USAGE_DB: m.db, USAGE_MODE: 'internal', INTERNAL_UIDS: ME, FIREBASE_SERVICE_ACCOUNT: SAJ };
      const r1 = await send(env, batch(Array.from({ length: 51 }, home)), bearer(ME));
      ok('51 events is a 400 and nothing is stored', r1.status === 400 && m.count('usage_events') === 0 && m.count('devices') === 0, r1);
      const r2 = await send(env, batch(Array.from({ length: 50 }, home)), bearer(ME));
      ok('companion: 50 events are accepted and stored', r2.status === 200 && r2.body.accepted === 50 && m.count('usage_events') === 50, r2);
    }

    // 4. The limiter: per signed-in person, per IP before sign-in (§8.7, S27).
    {
      const m = metered();
      const lim = allow();
      const env = { USAGE_DB: m.db, USAGE_MODE: 'on', PRIVACY_NOTICE: 'n2', FIREBASE_SERVICE_ACCOUNT: SAJ, USAGE_RATE_LIMITER: lim };
      const ip = { 'CF-Connecting-IP': '203.0.113.7' };
      await send(env, batch([home()]), Object.assign({}, ip, bearer(ME)));
      await send(env, batch([ev('screen.viewed', { screen: 'signin' })], { device: 'd_anon00000001' }), ip);
      ok('a signed-in batch is limited under its person, an anonymous one under its IP', lim.keys.join() === 'usage:' + ME + ',usage-anon:203.0.113.7', lim.keys);
      ok('companion: allowed, both were stored', m.count('usage_events') === 2, m.count('usage_events'));
      lim.deny = true;
      const c0 = m.calls;
      const d1 = await send(env, batch([home()]), Object.assign({}, ip, bearer(ME)));
      const d2 = await send(env, batch([ev('screen.viewed', { screen: 'signin' })], { device: 'd_anon00000001' }), ip);
      ok('a refused limiter is a 429, signed in or not', d1.status === 429 && d2.status === 429, [d1, d2]);
      ok('and nothing is stored or even asked of D1', m.count('usage_events') === 2 && m.calls === c0, { stored: m.count('usage_events'), calls: m.calls - c0 });
      lim.deny = false; lim.throws = true;
      const t1 = await send(env, batch([home()]), Object.assign({}, ip, bearer(ME)));
      ok('a limiter that throws follows the route\'s policy (fails open) and the batch is answered', t1.status === 200, t1);
    }

    // 5. A household is stamped only when its members map confirms the claim (S22, F4).
    {
      const m = metered();
      const env = { USAGE_DB: m.db, USAGE_MODE: 'internal', INTERNAL_UIDS: ME + ',' + STALE, FIREBASE_SERVICE_ACCOUNT: SAJ };
      const r1 = await send(env, batch([home()], { device: 'd_stale0000001' }), bearer(STALE));
      ok('a removed caregiver whose users doc still claims the household is stored', r1.status === 200 && r1.body.accepted === 1, r1);
      ok('with hid null on her event and her membership row: the claim alone stamps nothing', m.rows("SELECT hid FROM usage_events WHERE uid = '" + STALE + "'").map((x) => x.hid).join() === '' && m.count('usage_events', "uid = '" + STALE + "' AND hid IS NULL") === 1
        && m.count('membership', "uid = '" + STALE + "' AND hid IS NULL") === 1, m.rows('SELECT uid, hid, role FROM membership'));
      const r2 = await send(env, batch([home()]), bearer(ME));
      ok('companion: a person the members map holds is stamped with the household', r2.status === 200 && m.rows("SELECT hid, role FROM usage_events WHERE uid = '" + ME + "'").map((x) => x.hid + ':' + x.role).join() === 'hhMine01:owner', m.rows('SELECT uid, hid, role FROM usage_events'));
    }

    // 6. Past a ceiling the route stops touching D1 for the rest of the UTC day (W1, the recordStep pattern).
    {
      clock = DAY1 + DAYMS;                       // Tuesday 17 November, 06:00 UTC: a day nothing above used
      const m = metered();
      const env = { USAGE_DB: m.db, USAGE_MODE: 'on', USAGE_DAILY_CAP: '40', PRIVACY_NOTICE: 'n2', FIREBASE_SERVICE_ACCOUNT: SAJ, USAGE_RATE_LIMITER: allow() };
      const ten = () => batch(Array.from({ length: 10 }, home), { device: 'd_me0000000001' });
      const got = [];
      for (let i = 0; i < 4; i++) got.push((await send(env, ten(), bearer(ME))).body.accepted);
      ok('a family fills its share of a cap of 40 (30): 10, 10, 10, then refused', got.join() === '10,10,10,0', got);
      let c0 = m.calls, f0 = fsReads;
      const past = [];
      for (let i = 0; i < 20; i++) past.push(await send(env, ten(), bearer(ME)));
      ok('20 more batches past the ceiling are answered, refused', past.every((r) => r.status === 200 && r.body.accepted === 0 && r.body.refused === 10), past[0]);
      ok('with no D1 call at all, membership read included', m.calls === c0, m.calls - c0);
      ok('and no Firestore read', fsReads === f0, fsReads - f0);
      const visits = () => batch(Array.from({ length: 5 }, () => ev('visit.started', { opened_from: 'link', start: 'cold' })), { device: 'd_anon00000002' });
      const ag = [];
      for (let i = 0; i < 3; i++) ag.push((await send(env, visits(), { 'CF-Connecting-IP': '198.51.100.9' })).body.accepted);
      ok('batches with no sign-in fill their own quarter (10): 5, 5, then refused', ag.join() === '5,5,0', ag);
      c0 = m.calls;
      for (let i = 0; i < 20; i++) await send(env, visits(), { 'CF-Connecting-IP': '198.51.100.9' });
      ok('and past it make no D1 call either', m.calls === c0, m.calls - c0);
      // Every event refused: counted until the refusal ceiling, then not at all.
      const bad = () => batch([{ name: 'nope' }, ev('visit.started', { a: 1 }), ev('feature.used', { feature: 'feed', action: 'logged' })], { device: 'd_anon00000003' });
      const before = m.count('usage_refused') ? m.rows('SELECT SUM(n) AS s FROM usage_refused')[0].s : 0;
      let quiet = -1;
      for (let i = 0; i < 400; i++) { const c = m.calls; await send(env, bad(), { 'CF-Connecting-IP': '198.51.100.9' }); if (m.calls === c) { quiet = i; break; } }
      ok('a stream of all-refused batches stops reaching D1 once refusals hit their own ceiling (after ' + quiet + ')', quiet > 0, quiet);
      ok('companion: until then they were counted', m.rows('SELECT SUM(n) AS s FROM usage_refused')[0].s > before);
      c0 = m.calls;
      for (let i = 0; i < 20; i++) await send(env, bad(), { 'CF-Connecting-IP': '198.51.100.9' });
      ok('and 20 more make no D1 call', m.calls === c0, m.calls - c0);
      clock = DAY1 + 2 * DAYMS;                   // Wednesday 18 November, 06:00 UTC
      c0 = m.calls;
      const nx = await send(env, ten(), bearer(ME));
      ok('companion: on the next UTC day the same isolate asks D1 again and stores (pinned 06:00 UTC, 18 Nov)', nx.body.accepted === 10 && m.calls > c0, { nx, calls: m.calls - c0 });
      clock = DAY1;
    }

    // 7. Log lines (S15): codes only, never a uid, an email or a body. Every console method is recorded.
    {
      const m = metered({ hooks: { before(sql) { if (/INTO usage_events/.test(sql)) throw new Error('UNIQUE constraint failed for ' + ME + ' ' + PAD); } } });
      const lim = allow();
      const env = { USAGE_DB: m.db, USAGE_MODE: 'internal', INTERNAL_UIDS: ME, FIREBASE_SERVICE_ACCOUNT: SAJ, USAGE_RATE_LIMITER: lim };
      const r = await send(env, batch([home()], { pad: PAD }), bearer(ME));
      ok('a store failure never fails the request', r.status === 200, r);
      lim.deny = true;
      await send(env, batch([home()], { pad: PAD }), bearer(ME));
      ok('companion: the route DID log during this test, on console.error and console.log alike', lines.some((l) => l === 'error usage_store_fail') && lines.some((l) => l === 'log ratelimit_deny usage'), lines.filter((l) => /usage/.test(l)).slice(0, 6));
      ok('no recorded line names a uid, an email or anything from a body (' + lines.length + ' lines)', leaks(lines).length === 0, leaks(lines).slice(0, 4));
      const n0 = lines.length;
      console.log('usage_req', ME);                // planted through the same recorder
      ok('companion: the same matcher finds a uid planted on console.log', leaks(lines.slice(n0)).length === 1, lines.slice(n0));
      lines.length = n0;
    }
    // 8. The membership cache (§8.7): nothing links a person to a household before she has seen the notice
    //    (G4), and its writes are bounded (MEMB-BOUND). Mode on, PRIVACY_NOTICE n2. Pinned: Thursday 19
    //    November 2026, one batch every 10 minutes and 1 second from 00:05 to 23:57 UTC (one UTC day; the
    //    recheck is due once MORE than 10 minutes have passed).
    {
      const UNSEEN = 'uidUnseen0000000000000000005', SEEN = 'uidSeen00000000000000000006', TAPPER = 'uidTapper000000000000000007', FOUNDER = 'uidFounderInt0000000000008';
      const T0 = Date.UTC(2026, 10, 19, 0, 5, 0), MIN = 60000, STEP = 10 * MIN + 1000;
      clock = T0;
      docs.set('households/hhCirc01', { members: { mapValue: { fields: { [UNSEEN]: { stringValue: 'caregiver' }, [SEEN]: { stringValue: 'owner' }, [TAPPER]: { stringValue: 'caregiver' }, [FOUNDER]: { stringValue: 'owner' } } } } });
      for (const [u, n] of [[UNSEEN, 'n1'], [SEEN, 'n2'], [TAPPER, 'n1'], [FOUNDER, '']]) docs.set('users/' + u, { householdId: { stringValue: 'hhCirc01' }, privacyNoticeSeen: { stringValue: n } });
      const m = metered();
      // Every row written to membership, counted by a trigger (inserts and updates alike).
      m.raw.raw.exec("CREATE TABLE _mw (uid TEXT, n INTEGER); CREATE TRIGGER _mw_i AFTER INSERT ON membership BEGIN INSERT INTO _mw VALUES (NEW.uid, 1); END; "
        + 'CREATE TRIGGER _mw_u AFTER UPDATE ON membership BEGIN INSERT INTO _mw VALUES (NEW.uid, 1); END;');
      const writesOf = (u) => m.rows("SELECT COUNT(*) AS c FROM _mw WHERE uid = '" + u + "'")[0].c;
      const memRow = (u) => m.rows("SELECT hid, role, notice FROM membership WHERE uid = '" + u + "'")[0] || null;
      const env = { USAGE_DB: m.db, USAGE_MODE: 'on', PRIVACY_NOTICE: 'n2', USAGE_DAILY_CAP: '100000', FIREBASE_SERVICE_ACCOUNT: SAJ };
      // A row of each of two people stored earlier with no household (unconfirmed then): the backfill's target.
      const old = (u) => m.raw.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-11-19', 0, 'UTC', ?, 'd_k3j9x2m7q1aa', 'v_old00001', 'browser', 'macOS', 'Safari', 'v368', 'screen.viewed', '{\"screen\":\"home\"}')").run(u, 'old-' + u, T0 - 30 * MIN, T0 - 30 * MIN, u);
      old(UNSEEN); old(SEEN);

      // a) A whole day of batches from a person who has not seen the notice; she rewrites her stale value
      //    every time (any value but the current one), as a script could.
      const got = [];
      for (let i = 0; i < 144; i++) {
        clock = T0 + i * STEP;
        docs.set('users/' + UNSEEN, { householdId: { stringValue: 'hhCirc01' }, privacyNoticeSeen: { stringValue: 'n1-' + i } });
        got.push((await send(env, batch([home()], { device: 'd_unseen000001' }), bearer(UNSEEN))).body.accepted);
      }
      ok('(staged: 144 batches, 00:05 to 23:57 UTC on 19 Nov 2026, every one refused for the notice)', got.length === 144 && got.every((x) => x === 0) && m.count('usage_events', "uid = '" + UNSEEN + "'") === 1, got.slice(0, 3));
      ok('G4: her membership row holds no household and no role', !!memRow(UNSEEN) && memRow(UNSEEN).hid === null && memRow(UNSEEN).role === null, memRow(UNSEEN));
      ok('G4: her household is never even read', (readsOf.get('households/hhCirc01') || 0) === 0, readsOf.get('households/hhCirc01'));
      ok('G4: nothing of hers is backfilled with the household', m.count('usage_events', "uid = '" + UNSEEN + "' AND hid IS NOT NULL") === 0, m.rows("SELECT id, hid FROM usage_events WHERE uid = '" + UNSEEN + "'"));
      ok('MEMB-BOUND: her day writes her membership row at most 5 times (once, then each 6 hours), not once a recheck (' + writesOf(UNSEEN) + ')', writesOf(UNSEEN) >= 1 && writesOf(UNSEEN) <= 5, writesOf(UNSEEN));
      ok('companion: her notice was still rechecked every 10 minutes (' + (readsOf.get('users/' + UNSEEN) || 0) + ' reads)', (readsOf.get('users/' + UNSEEN) || 0) >= 140, readsOf.get('users/' + UNSEEN));
      // A burst inside one 10-minute window: this isolate remembers its check and asks Firestore once at most.
      const r0 = readsOf.get('users/' + UNSEEN) || 0;
      for (let i = 0; i < 5; i++) { clock = T0 + 143 * STEP + 30000 + i * 10000; await send(env, batch([home()], { device: 'd_unseen000001' }), bearer(UNSEEN)); }
      ok('MEMB-BOUND: five batches inside one 10-minute window read Firestore at most once', (readsOf.get('users/' + UNSEEN) || 0) - r0 <= 1, (readsOf.get('users/' + UNSEEN) || 0) - r0);

      // b) Companions: the same paths DO link a person who has seen the notice, and the founder in mode internal.
      clock = T0 + 60 * MIN;
      const rs = await send(env, batch([home()], { device: 'd_seen00000001' }), bearer(SEEN));
      ok('companion: a person who has seen the notice is stored and stamped with her household', rs.body.accepted === 1 && m.count('usage_events', "uid = '" + SEEN + "' AND hid = 'hhCirc01' AND role = 'owner'") === 2
        && memRow(SEEN).hid === 'hhCirc01' && memRow(SEEN).notice === 'n2', { rs, row: memRow(SEEN) });
      ok('companion: and her earlier unconfirmed row is backfilled', m.count('usage_events', "id = 'old-" + SEEN + "' AND hid = 'hhCirc01'") === 1);
      const fenv = { USAGE_DB: m.db, USAGE_MODE: 'internal', INTERNAL_UIDS: FOUNDER, PRIVACY_NOTICE: 'n2', FIREBASE_SERVICE_ACCOUNT: SAJ };
      const rf = await send(fenv, batch([home()], { device: 'd_found0000001' }), bearer(FOUNDER));
      ok('companion: in mode internal the founder is stamped whatever his notice (spec §8.7)', rf.body.accepted === 1 && memRow(FOUNDER).hid === 'hhCirc01', { rf, row: memRow(FOUNDER) });

      // c) "Got it" still counts from her next batch after the 10-minute recheck, not 6 hours later.
      clock = T0 + 12 * 60 * MIN;
      const t1 = await send(env, batch([home()], { device: 'd_tapper000001' }), bearer(TAPPER));
      docs.set('users/' + TAPPER, { householdId: { stringValue: 'hhCirc01' }, privacyNoticeSeen: { stringValue: 'n2' } });   // she taps "Got it"
      clock = T0 + 12 * 60 * MIN + 5 * MIN;
      const t2 = await send(env, batch([home()], { device: 'd_tapper000001' }), bearer(TAPPER));
      clock = T0 + 12 * 60 * MIN + 11 * MIN;
      const t3 = await send(env, batch([home()], { device: 'd_tapper000001' }), bearer(TAPPER));
      ok('companion: refused before "Got it", still refused inside the 10 minutes, stored and stamped after them', t1.body.accepted === 0 && t2.body.accepted === 0 && t3.body.accepted === 1
        && m.count('usage_events', "uid = '" + TAPPER + "' AND hid = 'hhCirc01'") === 1 && memRow(TAPPER).hid === 'hhCirc01', { t1: t1.body, t2: t2.body, t3: t3.body, row: memRow(TAPPER) });
      clock = DAY1;
    }

    // 9. The membership ceiling (MEMB-BOUND): MEMBERSHIP_DAILY_ROWS rows a UTC day across everyone, however
    //    many people sign in. 1,100 people who have seen the notice each send one batch. Pinned: Friday
    //    20 November 2026, 06:00 UTC.
    if (withCeiling) {
      clock = Date.UTC(2026, 10, 20, 6, 0, 0);
      const people = Array.from({ length: 1100 }, (x, i) => 'uidCeil' + String(i).padStart(21, '0'));
      people.forEach((u, i) => {
        docs.set('users/' + u, { householdId: { stringValue: 'hhBig' + i }, privacyNoticeSeen: { stringValue: 'n2' } });
        docs.set('households/hhBig' + i, { members: { mapValue: { fields: { [u]: { stringValue: 'caregiver' } } } } });
      });
      const m = metered();
      m.raw.raw.exec('CREATE TABLE _mw (n INTEGER); CREATE TRIGGER _mw_i AFTER INSERT ON membership BEGIN INSERT INTO _mw VALUES (1); END; CREATE TRIGGER _mw_u AFTER UPDATE ON membership BEGIN INSERT INTO _mw VALUES (1); END;');
      const env = { USAGE_DB: m.db, USAGE_MODE: 'on', PRIVACY_NOTICE: 'n2', USAGE_DAILY_CAP: '100000', FIREBASE_SERVICE_ACCOUNT: SAJ };
      let accepted = 0;
      for (const u of people) accepted += (await send(env, batch([home()], { device: 'd_' + u.slice(-12) }), bearer(u))).body.accepted;
      const written = m.rows('SELECT COUNT(*) AS c FROM _mw')[0].c;
      ok('1,100 people in one UTC day write at most 1,000 membership rows (' + written + ')', written <= 1000, written);
      ok('companion: the trigger counted writes up to the ceiling, so the count could move', written >= 1000, written);
      const stamped = m.rows("SELECT COUNT(*) AS c FROM usage_events e WHERE e.hid = 'hhBig' || CAST(SUBSTR(e.uid, 8) AS INTEGER)")[0].c;
      ok('and every one of them was still stored and stamped with her own household', accepted === 1100 && stamped === 1100, { accepted, stamped });
      clock = DAY1;
    }
    // 10. An account purge reaches every isolate's memory of her (RE-SK-3), and only hers (SE-V8). Past the
    //     membership ceiling no row is written, so this isolate's memo was tied to "no row", which the purge
    //     cannot change: her erasure marker, held for a memo's whole life, is what stops it. Mode on,
    //     PRIVACY_NOTICE n2. Pinned: Saturday 21 November 2026, 06:00 UTC onwards, and 23:20 UTC to Sunday 22
    //     November 2026, 00:10 UTC for a memo across midnight.
    {
      const LEAVER = 'uidLeaving000000000000000009', ERASING = 'uidErasing000000000000000010', KEEPER = 'uidKeeping000000000000000011', NOBODY = 'uidNobody0000000000000000012', NIGHT = 'uidNight00000000000000000013';
      const T0 = Date.UTC(2026, 10, 21, 6, 0, 0), MIN = 60000;
      for (const [u, h] of [[LEAVER, 'hhLeave01'], [KEEPER, 'hhKeep01'], [NOBODY, 'hhNobody01'], [NIGHT, 'hhNight01']]) {
        docs.set('users/' + u, { householdId: { stringValue: h }, privacyNoticeSeen: { stringValue: 'n2' } });
        docs.set('households/' + h, { members: { mapValue: { fields: { [u]: { stringValue: 'owner' } } } } });
      }
      const m = metered();
      m.raw.raw.prepare("INSERT INTO usage_meta (key, value, at) VALUES ('events_2026-11-21_membership', '1000', 1)").run();   // the day's membership ceiling is full
      const env = { USAGE_DB: m.db, USAGE_MODE: 'on', PRIVACY_NOTICE: 'n2', USAGE_DAILY_CAP: '100000', FIREBASE_SERVICE_ACCOUNT: SAJ };
      const hers = () => m.count('usage_events', "uid = '" + LEAVER + "'");
      const reads = (u) => readsOf.get('users/' + u) || 0;
      const purge = (u) => w.fetch(new Request(HOST + '/api/account/purge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: idToken(u) }) }), env, ctx);
      clock = T0;
      const a = await send(env, batch([home()], { device: 'd_leaving00001' }), bearer(LEAVER));
      const k0 = await send(env, batch([home()], { device: 'd_keeping00001' }), bearer(KEEPER));
      ok('(staged: past the membership ceiling her batch is stored and stamped, and no membership row is written)', a.body.accepted === 1 && m.count('usage_events', "uid = '" + LEAVER + "' AND hid = 'hhLeave01'") === 1
        && m.count('membership', "uid = '" + LEAVER + "'") === 0 && k0.body.accepted === 1 && m.count('membership') === 0, { a: a.body, k0: k0.body, rows: m.count('membership') });
      const r0 = reads(LEAVER);
      clock = T0 + 20 * MIN;
      const b = await send(env, batch([home()], { device: 'd_leaving00001' }), bearer(LEAVER));
      ok('companion: with no purge, 20 minutes on this isolate still answers from its memory (no Firestore read) and stamps her', b.body.accepted === 1 && reads(LEAVER) === r0 && hers() === 2, { b: b.body, reads: reads(LEAVER) - r0 });
      // She deletes her account: the app deletes users/{uid}, then calls the purge. The cron runs at 06:30.
      clock = T0 + 25 * MIN;
      docs.delete('users/' + LEAVER);
      const pr = await purge(LEAVER);
      ok('(staged: the purge answers ok and erases her rows)', pr.status === 200 && hers() === 0, { status: pr.status, left: hers() });
      clock = T0 + 30 * MIN;
      await w.scheduled({}, env);
      clock = T0 + 45 * MIN;
      const c = await send(env, batch([home()], { device: 'd_leaving00001' }), bearer(LEAVER));
      ok('RE-SK-3: 20 minutes after her purge, a cron tick between, a batch on her still-valid token is refused, not stamped from this isolate\'s memory', c.body.accepted === 0 && hers() === 0, { c: c.body, left: m.rows("SELECT hid FROM usage_events WHERE uid = '" + LEAVER + "'") });
      ok('companion: refused by her erasure marker, held through the cron\'s tick, with no Firestore read', reads(LEAVER) === r0 && m.count('usage_meta', "key = 'erase_uid:" + LEAVER + "'") === 1, { reads: reads(LEAVER) - r0 });
      // Another person past the ceiling: her purge changed nothing for him (SE-V8).
      const k0r = reads(KEEPER);
      const k1 = await send(env, batch([home()], { device: 'd_keeping00001' }), bearer(KEEPER));
      ok('SE-V8: another person\'s purge leaves everyone else\'s memory alone: his batch is answered from it, with no Firestore read, and stamped', k1.body.accepted === 1 && reads(KEEPER) === k0r
        && m.count('usage_events', "uid = '" + KEEPER + "' AND hid = 'hhKeep01'") === 2, { k1: k1.body, reads: reads(KEEPER) - k0r });
      const metaNow = () => JSON.stringify(m.rows('SELECT key, value, at FROM usage_meta ORDER BY key'));
      const metaBefore = metaNow();
      const pn = await purge(NOBODY);
      ok('SE-V8: a purge that finds nothing of hers writes nothing to cubby-usage', pn.status === 200 && metaNow() === metaBefore, { status: pn.status, before: metaBefore.slice(0, 200), after: metaNow().slice(0, 200) });
      // A person whose erasure is still pending: a fresh membership row of hers is still there.
      m.raw.raw.prepare("INSERT INTO membership (uid, hid, role, notice, checked_at) VALUES (?, 'hhLeave01', 'owner', 'n2', ?)").run(ERASING, T0 + 44 * MIN);
      m.raw.raw.prepare('INSERT INTO usage_meta (key, value, at) VALUES (?, ?, ?)').run('erase_uid:' + ERASING, String(T0 + 44 * MIN), T0 + 44 * MIN);
      const d = await send(env, batch([home()], { device: 'd_erasing00001' }), bearer(ERASING));
      ok('while her erasure is pending, nothing links her: her batch is refused whatever her membership row says', d.body.accepted === 0 && m.count('usage_events', "uid = '" + ERASING + "'") === 0, d.body);
      m.raw.raw.prepare('DELETE FROM usage_meta WHERE key = ?').run('erase_uid:' + ERASING);
      const e2 = await send(env, batch([home()], { device: 'd_erasing00001' }), bearer(ERASING));
      ok('companion: once no erasure is pending, the same fresh row stamps her', e2.body.accepted === 1 && m.count('usage_events', "uid = '" + ERASING + "' AND hid = 'hhLeave01'") >= 1, e2.body);
      /* A memo with no row and nothing of hers stored, across midnight. At 23:20 the families' share of the
         day is full, so her batch is refused after this isolate took its memo; she deletes her account at
         23:30, and the purge, finding nothing of hers, writes no marker. A batch at 00:10 on the token she had
         at 23:30 (an hour's life) must not be stamped from that memo: it ended with its UTC day. */
      clock = Date.UTC(2026, 10, 21, 23, 20, 0);
      m.raw.raw.prepare("INSERT INTO usage_meta (key, value, at) VALUES ('events_2026-11-21', '75000', 1) ON CONFLICT(key) DO UPDATE SET value = '75000'").run();
      const n1 = await send(env, batch([home()], { device: 'd_night0000001' }), bearer(NIGHT));
      const nr0 = reads(NIGHT);
      clock = Date.UTC(2026, 10, 21, 23, 30, 0);
      docs.delete('users/' + NIGHT);
      const tok = bearer(NIGHT);
      const pnight = await purge(NIGHT);
      ok('(staged: at 23:20 her batch was refused by the full share after her memo was taken, and at 23:30 her purge found nothing of hers and wrote no marker)', n1.body.accepted === 0 && nr0 === 1
        && pnight.status === 200 && m.count('usage_events', "uid = '" + NIGHT + "'") === 0 && m.count('usage_meta', "key = 'erase_uid:" + NIGHT + "'") === 0, { n1: n1.body, nr0 });
      clock = Date.UTC(2026, 10, 21, 23, 40, 0);
      const n2 = await send(env, batch([home()], { device: 'd_night0000001' }), tok);
      ok('companion: the same day this isolate refuses her batch for the full share, without reading her memory or Firestore', n2.body.accepted === 0 && reads(NIGHT) === nr0, { n2: n2.body, reads: reads(NIGHT) - nr0 });
      clock = Date.UTC(2026, 10, 22, 0, 10, 0);
      const n3 = await send(env, batch([home()], { device: 'd_night0000001' }), tok);
      ok('RE-SK-3: past midnight her memo with no row is not used: her batch is not stamped with her old household (pinned 22 November 2026, 00:10 UTC)', m.count('usage_events', "uid = '" + NIGHT + "' AND hid IS NOT NULL") === 0, { n3: n3.body, rows: m.rows("SELECT hid FROM usage_events WHERE uid = '" + NIGHT + "'") });
      ok('companion: this isolate read Firestore again, and found her gone', reads(NIGHT) === nr0 + 1 && n3.body.accepted === 0, { reads: reads(NIGHT) - nr0, n3: n3.body });
      clock = DAY1;
    }
  } catch (e) {
    fail++; if (!quiet) realLog('  FAIL the suite threw: ' + (e && e.stack || e));
  } finally {
    Date.now = realNow;
    console.log = realLog; console.error = realErr; console.warn = realWarn; console.info = realInfo;
  }
  return { pass, fail };
}

/* A temp directory holding the tree's worker.js and, recursively, every relative module it imports, with the
   given edits applied. A module that cannot be found throws here, loudly; a mutant that will not load is
   reported as such and never counted as caught. */
function mutantTree(edits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-route-mut-'));
  const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
  const place = (rel) => {
    let text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const [file, find, repl] of edits) if (path.normalize(file) === path.normalize(rel)) text = text.replace(find, repl);
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
    for (const m of text.matchAll(IMPORT)) {
      const dep = path.join(path.dirname(rel), m[1]);
      if (!fs.existsSync(path.join(dir, dep))) place(dep);
    }
  };
  place('worker.js');
  return dir;
}

const W = 'worker.js', C = 'workers/usage/core.mjs';
const BREAKS = [
  ['mode off reads the body first (W7)', [[W, "  /* Mode off, or no database yet: answer before reading the body, a token check or a limiter. */\n  if (!env.USAGE_DB || usageModeOf(env) === 'off') return json({ mode: 'off' });\n", ''],
    [W, "  let body; try { body = JSON.parse(raw); } catch (e) { return json({ error: 'bad_request' }, 400); }\n  let uid = null;", "  if (!env.USAGE_DB || usageModeOf(env) === 'off') return json({ mode: 'off' });\n  let body; try { body = JSON.parse(raw); } catch (e) { return json({ error: 'bad_request' }, 400); }\n  let uid = null;"]]],
  ['the body is buffered whole and its UTF-16 length checked (W7)', [[W, "  if (!request.body) return '';\n", "  { const t = await request.text(); return t.length > maxBytes ? null : t; }\n"]]],
  ['the stream is never cut off (F3)', [[W, '    if (size > maxBytes) { reader.cancel().catch(() => {}); return null; }\n', '']]],
  ['each piece of the body is decoded on its own (VI-1)', [[W, '  return new TextDecoder().decode(buf);\n', "  return parts.map((p) => new TextDecoder().decode(p)).join('');\n"]]],
  ['the Content-Length check is dropped (F3)', [[W, "  if (Number(request.headers.get('content-length') || 0) > maxBytes) return null;\n", '']]],
  ['more than 50 events a batch (F3)', [[C, 'body.events.length > LIMITS.maxEvents', 'body.events.length > 100000']]],
  ['the limiter is skipped (F3)', [[W, "  if (await rateLimited(limiter, uid ? 'usage:' + uid : 'usage-anon:' + clientIpKey(request), 'usage')) return json({ error: 'rate' }, 429);\n", '']]],
  ['a signed-in batch is limited per IP, not per person (F3)', [[W, "uid ? 'usage:' + uid : 'usage-anon:' + clientIpKey(request)", "'usage-anon:' + clientIpKey(request)"]]],
  ['anonymous batches share one limiter key (F3)', [[W, "uid ? 'usage:' + uid : 'usage-anon:' + clientIpKey(request)", "uid ? 'usage:' + uid : 'usage-anon'"]]],
  ['a household claim is stamped without the members check (F4)', [[W, 'if (hh.ok && _isCarer(hh.doc.fields, uid)) {', 'if (hh.ok) {']]],
  ['the route passes no isolate state (W1)', [[W, '    isolate: usageIsolate,\n', '']]],
  ['a new isolate state every request (W1)', [[W, '    isolate: usageIsolate,\n', '    isolate: usageNewIsolate(),\n']]],
  ['the route logs the uid on console.log (F5)', [[W, '  const now = Date.now();\n  const out = await usageIngest(body, {', "  console.log('usage_req', uid);\n  const now = Date.now();\n  const out = await usageIngest(body, {"]]],
  ['a store-failure log line carries the uid (F5)', [[W, '    log: (code) => console.error(code),', '    log: (code) => console.error(code, uid),']]],
  ['another origin is accepted', [[W, "  if (!same) return json({ error: 'forbidden' }, 403);\n  /* Mode off, or no database yet", "  /* Mode off, or no database yet"]]],
  ['a person who has not seen the notice is linked to her household (G4)', [[W, "const linkable = mode === 'internal' ? usageInternalSet(env).has(uid) : (mode === 'on' && !!notice && seen === notice);", 'const linkable = true;']]],
  ['the founder in mode internal waits for the notice too (G4, spec §8.7)', [[W, "const linkable = mode === 'internal' ? usageInternalSet(env).has(uid) : (mode === 'on' && !!notice && seen === notice);", "const linkable = !!notice && seen === notice;"]]],
  ['every recheck rewrites the membership row (MEMB-BOUND)', [[W, 'if (!row || usageMemberSig(answer) !== usageMemberSig(row) || now - Number(row.checked_at || 0) >= USAGE_MEMBERSHIP_TTL) {', 'if (true) {']]],
  ['the row keeps her raw notice value, so each new value is a write (MEMB-BOUND)', [[W, "const answer = { hid, role, notice: notice && seen === notice ? notice : '', checked_at: now };", 'const answer = { hid, role, notice: seen, checked_at: now };']]],
  ['the membership ceiling is skipped (MEMB-BOUND)', [[W, "usageIsolate.full.get('membership') !== day && await usageTakeSlots(db, 'membership', day, 1, usageCeilingsOf(env).membership, now)", 'true']], { ceiling: true }],
  ['the isolate forgets its own recheck, so Firestore is asked every batch (MEMB-BOUND)', [[W, '  if (memo && memo.sig === usageMemberSig(row) && usageMemberFresh(memo.answer, memo.at, notice, now)\n    && (row || usageUtcDay(memo.at) === usageUtcDay(now))) return memo.answer;\n', '']]],
  ['a memory with no row outlives its UTC day (RE-SK-3)', [[W, '    && (row || usageUtcDay(memo.at) === usageUtcDay(now))) return memo.answer;', '    ) return memo.answer;']]],
  ['the account purge marks her only when rows are left over (RE-SK-3)', [[C, '    await mark(done ? now + ERASE_HOLD_MS : now);', '    if (!done) await mark(now);']]],
  ['a person\'s marker is not held for the membership memory\'s life (RE-SK-3)', [[C, 'export const ERASE_HOLD_MS = MEMBERSHIP_TTL_MS;', 'export const ERASE_HOLD_MS = 0;']]],
  ['a purge that finds nothing of hers still writes a marker (SE-V8)', [[C, '    if (!any) return { done: true, erased: 0, ran: true };\n', '']]],
  ['a pending erasure still links her (ERASE-CHUNK)', [[W, "  if (got.erasing) return { hid: null, role: null, notice: '', checked_at: now };\n", '']]],
];

(async () => {
  if (!SELF) {
    console.log('\nusage-route\n');
    const r = await suite(path.join(ROOT, 'worker.js'), false);
    if (r.loadError) { console.log('  FAIL worker.js did not load: ' + r.loadError); r.fail++; }
    console.log(r.pass + ' passed, ' + r.fail + ' failed');
    console.log('USAGE-ROUTE: ' + (r.fail ? 'FAIL' : 'PASS'));
    process.exit(r.fail ? 1 : 0);
  }
  const run = async (edits, o) => { const dir = mutantTree(edits); try { return await suite(path.join(dir, 'worker.js'), true, o); } finally { fs.rmSync(dir, { recursive: true, force: true }); } };
  let good = true, caught = 0;
  /* Paired: an unaltered tree copied the same way must pass every check, so each red below is its break's. */
  const clean = await run([]);
  if (clean.loadError) { good = false; console.log('  FAIL an unaltered copy did not load: ' + clean.loadError); }
  else if (clean.fail) { good = false; console.log('  FAIL an unaltered copy in a temp tree fails ' + clean.fail + ' check(s)'); }
  else console.log('  ok   an unaltered copy in a temp tree passes (' + clean.pass + ' checks)');
  for (const [name, edits, o] of BREAKS) {
    const missing = edits.filter(([file, find]) => { const src = fs.readFileSync(path.join(ROOT, file), 'utf8'); const at = src.indexOf(find); return at < 0 || src.indexOf(find, at + 1) >= 0; });
    if (missing.length) { good = false; console.log('  FAIL anchor missing or not unique for: ' + name); continue; }
    const r = await run(edits, { ceiling: !!(o && o.ceiling) });
    if (r.loadError) { good = false; console.log('  FAIL did not load, so not caught: ' + name + ' (' + r.loadError + ')'); }
    else if (r.fail > 0) { caught++; console.log('  ok   caught (' + r.fail + ' red): ' + name); }
    else { good = false; console.log('  FAIL not caught: ' + name); }
  }
  console.log('self-test: ' + caught + ' of ' + BREAKS.length + ' breaks caught');
  good = good && caught === BREAKS.length;
  console.log('USAGE-ROUTE SELF-TEST: ' + (good ? 'PASS' : 'FAIL'));
  process.exit(good ? 0 : 1);
})().catch((e) => { console.error('threw:', e && e.stack || e); process.exit(1); });
