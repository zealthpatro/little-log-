/* The Worker's smaller public routes, under the abuse the round-4 review found, driven through the
 * REAL worker.js fetch handler.
 *
 *   1. /api/send-invite and /api/invite-peek (NP-7): any account can own a household and mint links,
 *      and each link was one Cubby-branded email to any address, headed by free text the sender typed.
 *      Names are capped at 40 characters, an inviter's name appears only with a proven sender
 *      (fromEmail), and each account has a day ceiling in D1.
 *   2. /api/newsletter (NP-9): an address that unsubscribed is never flipped back, and the consent time
 *      is never overwritten, with the same answer either way.
 *   3. /api/dose and the game and hub reads (NP-11): garbage and D1 errors answer, they never throw.
 *   4. The guessing game and the games hub (SB-1, NP-8): reveal is rate-limited, anonymous writes must
 *      come from our own pages, and there is a day ceiling on all of them together.
 *   5. /api/step (SB-2): an inherited property name is not an event.
 *
 * D1 is real SQLite (node:sqlite), so the atomic upserts are exercised as written. Firestore, Google's
 * token and key endpoints, and Resend are stand-ins that record what they were asked; nothing leaves
 * this process (an unstubbed URL throws).
 *
 *   node test/worker-routes.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 400) : '')); } };

const HOST = 'https://little-cubby.com';
const PROJECT = 'little-log-a9caa';
const FS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const pem = () => nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SA = { project_id: PROJECT, client_email: 'cubby@' + PROJECT + '.iam.gserviceaccount.com', private_key: pem().privateKey };

/* Firebase ID tokens, signed by a key whose public half the stubbed JWK endpoint publishes. */
const idPair = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = Object.assign(idPair.publicKey.export({ format: 'jwk' }), { kid: 'test-kid', alg: 'RS256', use: 'sig' });
const b64u = (s) => Buffer.from(s).toString('base64url');
function idToken(uid, email) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ aud: PROJECT, iss: 'https://securetoken.google.com/' + PROJECT, sub: uid, iat: now - 5, exp: now + 3600, email }));
  return head + '.' + body + '.' + nodeCrypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), idPair.privateKey).toString('base64url');
}

/* A D1-shaped shim over real SQLite. `log` records every statement run; throwOn makes matching SQL
   fail when it runs, the way a D1 error surfaces. */
function makeD1(opts) {
  opts = opts || {};
  const db = new DatabaseSync(':memory:');
  const log = [];
  const prepare = (sql) => {
    let args = [];
    const go = (fn) => { log.push(sql); if (opts.throwOn && opts.throwOn.test(sql)) throw new Error('D1_ERROR: injected'); return fn(); };
    const st = {
      bind: (...a) => { args = a; return st; },
      run: async () => go(() => { db.prepare(sql).run(...args); return { success: true }; }),
      first: async () => go(() => { const r = db.prepare(sql).get(...args); return r ? Object.assign({}, r) : null; }),
      all: async () => go(() => ({ results: db.prepare(sql).all(...args).map((r) => Object.assign({}, r)) })),
    };
    return st;
  };
  return { prepare, batch: async (sts) => { for (const s of sts) await s.run(); return []; }, raw: db, log };
}

// ---- the world outside our code --------------------------------------------------------------
const docs = new Map();   // Firestore path under /documents/ -> fields
const mail = [];
const cacheStore = new Map();
globalThis.caches = { default: {
  async match(r) { const v = cacheStore.get(String(r.url)); return v === undefined ? undefined : new Response(v); },
  async put(r, res) { cacheStore.set(String(r.url), await res.text()); },
} };
const J = (o, s, h) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'content-type': 'application/json' }, h || {}) });
globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const method = ((init && init.method) || 'GET').toUpperCase();
  if (url.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 'tok', expires_in: 3600 });
  if (url === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') return J({ keys: [JWK] }, 200, { 'cache-control': 'max-age=3600' });
  if (url === 'https://api.resend.com/emails') { mail.push(JSON.parse(init.body)); return J({ id: 'm' + mail.length }); }
  if (url.startsWith(FS + '/') && method === 'GET') {
    const p = decodeURIComponent(url.slice(FS.length + 1).split('?')[0]);
    return docs.has(p) ? J({ name: FS + '/' + p, fields: docs.get(p) }) : J({ error: { status: 'NOT_FOUND' } }, 404);
  }
  throw new Error('unstubbed external call: ' + method + ' ' + url);
};

const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = async (w, method, p, body, env, headers) => {
  const init = { method, headers: Object.assign({ 'content-type': 'application/json' }, headers === undefined ? { Origin: HOST } : headers) };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  try {
    const r = await w.fetch(new Request(HOST + p, init), env, ctx);
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (e) {}
    return { status: r.status, body: j, threw: null };
  } catch (e) { return { status: 0, body: null, threw: String((e && e.message) || e) }; }
};
const str = (x) => ({ stringValue: x });
const future = () => ({ timestampValue: new Date(Date.now() + 86400000).toISOString() });
function seedHousehold(hid, ownerUid, familyName) {
  docs.set('households/' + hid, {
    members: { mapValue: { fields: { [ownerUid]: str('owner') } } },
    app: { mapValue: { fields: { settings: { mapValue: { fields: familyName ? { householdName: str(familyName) } : {} } } } } },
  });
}
function seedLink(token, hid, fields) {
  docs.set('inviteLinks/' + token, Object.assign({ householdId: str(hid), expiresAt: future() }, fields || {}));
}
let tokSerial = 0;
const newToken = () => 'tok' + String(++tokSerial).padStart(5, '0') + 'abcdefghijklmn';

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-routes-'));
  for (const im of src.matchAll(/^import\s[^;]*?from\s+['"](\.\/[^'"]+)['"]/gm)) {
    const to = path.join(dir, im[1]); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(__dirname, '..', im[1]), to);
  }
  fs.writeFileSync(path.join(dir, 'worker.mjs'), src);
  /* A fresh module is a fresh isolate: the day-ceiling memos live in module scope, so every section
     that is about them gets its own. */
  let iso = 0;
  const isolate = async () => (await import(pathToFileURL(path.join(dir, 'worker.mjs')).href + '?isolate=' + (++iso))).default;

  const BASE_ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), RESEND_API_KEY: 're_test' };
  const LONG = 'Meera' + 'x'.repeat(60);
  const FAMILY = 'The ' + 'Y'.repeat(60) + ' family';
  const SCARY = 'Your midwife. Urgent: call 0800 000 000 about your scan results today';
  const OWNER = 'uOwner', OWNER2 = 'uOwner2';
  seedHousehold('H1', OWNER, FAMILY);
  seedHousehold('H2', OWNER2, '');

  console.log('\n1. send-invite and invite-peek: a name only with a proven sender, and never more than 40 characters');
  {
    const w = await isolate();
    const env = Object.assign({ GAMES_DB: makeD1() }, BASE_ENV);
    const proven = newToken(), unsigned = newToken();
    seedLink(proven, 'H1', { invitedByName: str(LONG), fromEmail: str('meera@example.com') });
    seedLink(unsigned, 'H1', { invitedByName: str(SCARY) });
    const a = await call(w, 'POST', '/api/send-invite', { idToken: idToken(OWNER, 'meera@example.com'), token: proven, email: 'friend@example.com' }, env);
    const ah = a.status === 200 && mail.length ? String(mail[mail.length - 1].html) : '';
    const h1 = (ah.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
    ok('a proven link sends', a.status === 200 && !!ah, a);
    ok('with the inviter\'s name in the headline, cut at 40 characters', h1.indexOf(LONG.slice(0, 40) + ' has invited you') === 0, h1);
    ok('never the 41st', h1.indexOf(LONG.slice(0, 41)) < 0, h1);
    ok('and the family name cut at 40 too', h1.indexOf(FAMILY.slice(0, 40)) > -1 && h1.indexOf(FAMILY.slice(0, 41)) < 0, h1);
    const before = mail.length;
    const b = await call(w, 'POST', '/api/send-invite', { idToken: idToken(OWNER, 'meera@example.com'), token: unsigned, email: 'friend2@example.com' }, env);
    const bh = mail.length > before ? String(mail[mail.length - 1].html) : '';
    ok('a link with no proven sender still sends', b.status === 200 && !!bh, b);
    ok('but its typed name is nowhere in the email', !/midwife|Urgent|0800/.test(bh), (bh.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]);
    ok('it says, neutrally, that someone invited you', /<h1[^>]*>Someone has invited you to /.test(bh), (bh.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]);
    const pp = await call(w, 'GET', '/api/invite-peek?t=' + proven, undefined, env, {});
    ok('invite-peek of a proven link gives the name, cut at 40', pp.status === 200 && pp.body && pp.body.state === 'live' && pp.body.by === LONG.slice(0, 40), pp.body);
    const pu = await call(w, 'GET', '/api/invite-peek?t=' + unsigned, undefined, env, {});
    ok('invite-peek of a link with no proven sender gives no name', pu.status === 200 && pu.body && pu.body.state === 'live' && !pu.body.by, pu.body);
  }

  console.log('\n2. send-invite: a day ceiling per account');
  {
    const w = await isolate();
    const d1 = makeD1();
    const env = Object.assign({ GAMES_DB: d1, SEND_INVITE_DAILY_CAP: '3' }, BASE_ENV);
    const mailed = mail.length;
    const st = [];
    for (let i = 0; i < 5; i++) {
      const t = newToken(); seedLink(t, 'H1', { invitedByName: str('Meera'), fromEmail: str('meera@example.com') });
      st.push((await call(w, 'POST', '/api/send-invite', { idToken: idToken(OWNER), token: t, email: 'p' + i + '@example.com' }, env)).status);
    }
    ok('three sends go out, the fourth and fifth are refused', st.join(',') === '200,200,200,429,429' && mail.length === mailed + 3, [st, mail.length - mailed]);
    const t2 = newToken(); seedLink(t2, 'H2', {});
    const other = await call(w, 'POST', '/api/send-invite', { idToken: idToken(OWNER2), token: t2, email: 'q@example.com' }, env);
    ok('the ceiling is per account: another owner still sends', other.status === 200, other);
    const w2 = await isolate();
    const env2 = Object.assign({ GAMES_DB: makeD1(), SEND_INVITE_DAILY_CAP: '3' }, BASE_ENV);
    const m2 = mail.length;
    const toks = Array.from({ length: 10 }, () => { const t = newToken(); seedLink(t, 'H1', {}); return t; });
    const par = await Promise.all(toks.map((t, i) => call(w2, 'POST', '/api/send-invite', { idToken: idToken(OWNER), token: t, email: 'r' + i + '@example.com' }, env2)));
    ok('ten at once with a ceiling of three: exactly three emails', mail.length === m2 + 3 && par.filter((r) => r.status === 200).length === 3, [mail.length - m2, par.map((r) => r.status)]);
    const w3 = await isolate();
    const env3 = Object.assign({ GAMES_DB: makeD1() }, BASE_ENV);
    const m3 = mail.length;
    let refusedAt = 0;
    for (let i = 0; i < 31; i++) {
      const t = newToken(); seedLink(t, 'H1', {});
      const r = await call(w3, 'POST', '/api/send-invite', { idToken: idToken(OWNER), token: t, email: 's' + i + '@example.com' }, env3);
      if (r.status === 429 && !refusedAt) refusedAt = i + 1;
    }
    ok('the default ceiling is thirty a day', mail.length === m3 + 30 && refusedAt === 31, [mail.length - m3, refusedAt]);
    const w4 = await isolate();
    const t4 = newToken(); seedLink(t4, 'H1', {});
    const noDb = await call(w4, 'POST', '/api/send-invite', { idToken: idToken(OWNER), token: t4, email: 'u@example.com' }, BASE_ENV);
    ok('with no D1 bound it fails open: the owner checks still hold, and the invite goes', noDb.status === 200, noDb);
  }

  console.log('\n3. newsletter: an unsubscribe is never undone by a stranger, and consent is never rewritten');
  {
    const w = await isolate();
    const nd = makeD1();
    nd.raw.exec(fs.readFileSync(path.join(__dirname, '..', 'schema', 'newsletter.sql'), 'utf8'));
    const hash = (e) => nodeCrypto.createHash('sha256').update(e).digest('hex');
    const ins = nd.raw.prepare('INSERT INTO subscribers (email_hash,email,stage,source,utm_source,utm_campaign,status,unsub_token,consent_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    ins.run(hash('left@example.com'), 'left@example.com', 'baby', 'her', '', '', 'unsubscribed', 'u1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    ins.run(hash('stay@example.com'), 'stay@example.com', 'baby', 'her', '', '', 'subscribed', 'u2', '2026-02-02T00:00:00.000Z', '2026-02-02T00:00:00.000Z');
    const env = Object.assign({ NEWSLETTER_DB: nd }, BASE_ENV);
    const row = (e) => nd.raw.prepare('SELECT status, consent_at, source, unsub_token FROM subscribers WHERE email_hash = ?').get(hash(e));
    ok('the companion: the unsubscribed row is staged and readable', row('left@example.com').status === 'unsubscribed');
    const a = await call(w, 'POST', '/api/newsletter', { email: 'left@example.com', source: 'not her', stage: 'expecting' }, env);
    const left = row('left@example.com');
    ok('an unsubscribed address stays unsubscribed', left.status === 'unsubscribed', left);
    ok('with its consent time and its record untouched', left.consent_at === '2026-01-01T00:00:00.000Z' && left.source === 'her' && left.unsub_token === 'u1', left);
    const b = await call(w, 'POST', '/api/newsletter', { email: 'stay@example.com', source: 'footer' }, env);
    const stay = row('stay@example.com');
    ok('a subscribed address that signs up again keeps its first consent time', stay.status === 'subscribed' && stay.consent_at === '2026-02-02T00:00:00.000Z' && stay.unsub_token === 'u2', stay);
    ok('and refreshes what it may (where it signed up)', stay.source === 'footer', stay);
    const c = await call(w, 'POST', '/api/newsletter', { email: 'new@example.com', source: 'footer' }, env);
    const fresh = row('new@example.com');
    ok('a new address is subscribed, consent stamped now', fresh && fresh.status === 'subscribed' && Math.abs(Date.parse(fresh.consent_at) - Date.now()) < 60000, fresh);
    ok('and all three answers are the same, so nobody can ask who unsubscribed', [a, b, c].every((r) => r.status === 200 && JSON.stringify(r.body) === '{"ok":true}'), [a, b, c]);
  }

  console.log('\n4. garbage and D1 errors are answered, never thrown');
  {
    const w = await isolate();
    const env = Object.assign({}, BASE_ENV);
    for (const n of ['v1.x.y', 'v1.@@@.###', 'v1..', 'v1.e30.%%%', 'v1.e30.' + '*'.repeat(8), 'nope']) {
      const r = await call(w, 'POST', '/api/dose', { n }, env);
      ok('/api/dose ' + JSON.stringify(n) + ' is the one refusal, 401 bad_ticket', !r.threw && r.status === 401 && r.body && r.body.error === 'bad_ticket', r);
    }
    const empty = makeD1();
    const g = await call(w, 'GET', '/api/game/abcd1234', undefined, Object.assign({ GAMES_DB: empty }, env), {});
    ok('a game read on a fresh D1 with no tables answers 500 db_error, not a throw', !g.threw && g.status === 500 && g.body && g.body.error === 'db_error', g);
    const hd = makeD1({ throwOn: /FROM hub_games/ });
    hd.raw.exec("CREATE TABLE hubs (code TEXT PRIMARY KEY, owner_uid TEXT, title TEXT, created_at INTEGER); INSERT INTO hubs VALUES ('abcd1234','u','Our baby',1)");
    const h = await call(w, 'GET', '/api/hub/abcd1234', undefined, Object.assign({ GAMES_DB: hd }, env), {});
    ok('a hub read whose D1 fails part-way answers 500 db_error, not a throw', !h.threw && h.status === 500 && h.body && h.body.error === 'db_error', h);
  }

  console.log('\n5. the guessing game: reveal is rate-limited like every other route');
  {
    const w = await isolate();
    const d1 = makeD1();
    let refuse = /^greveal:/;
    const keys = [];
    const env = Object.assign({ GAMES_DB: d1, GAMES_RATE_LIMITER: { async limit(o) { keys.push(o.key); return { success: !refuse.test(o.key) }; } } }, BASE_ENV);
    const made = await call(w, 'POST', '/api/game/create', { title: 'Bump' }, env);
    ok('a game is created', made.status === 200 && made.body && !!made.body.hostKey, made);
    const r = await call(w, 'POST', '/api/game/' + made.body.code + '/reveal', { hostKey: made.body.hostKey, result: 'F' }, env);
    ok('a refused reveal is a 429', r.status === 429, r);
    ok('keyed on its own greveal bucket', keys.some((k) => /^greveal:/.test(k)), keys);
    ok('and nothing was written', d1.raw.prepare('SELECT result FROM games WHERE code = ?').get(made.body.code).result === '');
    refuse = /^$/;
    const r2 = await call(w, 'POST', '/api/game/' + made.body.code + '/reveal', { hostKey: made.body.hostKey, result: 'F' }, env);
    ok('the companion: allowed, the same reveal goes through', r2.status === 200 && d1.raw.prepare('SELECT result FROM games WHERE code = ?').get(made.body.code).result === 'F', r2);
  }

  console.log('\n6. anonymous game writes must come from our own pages');
  {
    const w = await isolate();
    const d1 = makeD1();
    const env = Object.assign({ GAMES_DB: d1 }, BASE_ENV);
    const made = await call(w, 'POST', '/api/game/create', { title: 'Bump' }, env);
    const code = made.body.code, hostKey = made.body.hostKey;
    d1.raw.exec("CREATE TABLE IF NOT EXISTS hubs (code TEXT PRIMARY KEY, owner_uid TEXT, title TEXT, created_at INTEGER); CREATE TABLE IF NOT EXISTS hub_games (id TEXT PRIMARY KEY, hub_code TEXT, type TEXT, prompt TEXT, status TEXT DEFAULT 'open', result TEXT DEFAULT '', created_at INTEGER); CREATE TABLE IF NOT EXISTS hub_guesses (id TEXT PRIMARY KEY, game_id TEXT, hub_code TEXT, nickname TEXT, guess TEXT, note TEXT, relation TEXT, created_at INTEGER); INSERT INTO hubs VALUES ('hubx1234','u','Our baby',1); INSERT INTO hub_games VALUES ('gm1','hubx1234','sex','Boy or girl?','open','',1)");
    const writes = () => d1.raw.prepare('SELECT (SELECT COUNT(*) FROM games) + (SELECT COUNT(*) FROM guesses) + (SELECT COUNT(*) FROM hub_guesses) AS n').get().n;
    const routes = [
      ['create', '/api/game/create', { title: 'x' }],
      ['guess', '/api/game/' + code + '/guess', { nickname: 'Nan', guess: 'F' }],
      ['reveal', '/api/game/' + code + '/reveal', { hostKey, result: 'M' }],
      ['hub guess', '/api/hub/hubx1234/guess', { gameId: 'gm1', nickname: 'Nan', guess: 'M' }],
    ];
    for (const [name, p, b] of routes) {
      const n0 = writes(), r0 = d1.raw.prepare('SELECT result FROM games WHERE code = ?').get(code).result;
      const none = await call(w, 'POST', p, b, env, {});
      const evil = await call(w, 'POST', p, b, env, { Origin: 'https://evil.example' });
      const evilRef = await call(w, 'POST', p, b, env, { Referer: 'https://evil.example/g/' + code });
      ok(name + ': no Origin or Referer is refused', none.status === 403, none);
      ok(name + ': another site is refused', evil.status === 403 && evilRef.status === 403, [evil.status, evilRef.status]);
      ok(name + ': and nothing was written', writes() === n0 && d1.raw.prepare('SELECT result FROM games WHERE code = ?').get(code).result === r0, [writes(), n0]);
      const mine = await call(w, 'POST', p, b, env, { Referer: HOST + '/g/' + code });
      ok(name + ': the companion: our own page goes through', mine.status === 200, mine);
    }
    const read = await call(w, 'GET', '/api/game/' + code, undefined, env, {});
    ok('reads stay open: a same-origin GET carries no Origin', read.status === 200, read);
  }

  console.log('\n7. a day ceiling on every anonymous game and hub write together');
  {
    const w = await isolate();
    const d1 = makeD1();
    const env = Object.assign({ GAMES_DB: d1, GAMES_DAILY_CAP: '5' }, BASE_ENV);
    d1.raw.exec("CREATE TABLE IF NOT EXISTS hubs (code TEXT PRIMARY KEY, owner_uid TEXT, title TEXT, created_at INTEGER); CREATE TABLE IF NOT EXISTS hub_games (id TEXT PRIMARY KEY, hub_code TEXT, type TEXT, prompt TEXT, status TEXT DEFAULT 'open', result TEXT DEFAULT '', created_at INTEGER); CREATE TABLE IF NOT EXISTS hub_guesses (id TEXT PRIMARY KEY, game_id TEXT, hub_code TEXT, nickname TEXT, guess TEXT, note TEXT, relation TEXT, created_at INTEGER); INSERT INTO hubs VALUES ('hubx1234','u','Our baby',1); INSERT INTO hub_games VALUES ('gm1','hubx1234','sex','Boy or girl?','open','',1)");
    const made = await call(w, 'POST', '/api/game/create', {}, env);
    const code = made.body && made.body.code;
    const st = [made.status];
    st.push((await call(w, 'POST', '/api/game/' + code + '/guess', { nickname: 'A', guess: 'F' }, env)).status);
    st.push((await call(w, 'POST', '/api/game/' + code + '/guess', { nickname: 'B', guess: 'M' }, env)).status);
    st.push((await call(w, 'POST', '/api/hub/hubx1234/guess', { gameId: 'gm1', nickname: 'C', guess: 'F' }, env)).status);
    st.push((await call(w, 'POST', '/api/hub/hubx1234/guess', { gameId: 'gm1', nickname: 'C2', guess: 'M' }, env)).status);
    const sixth = await call(w, 'POST', '/api/hub/hubx1234/guess', { gameId: 'gm1', nickname: 'D', guess: 'M' }, env);
    ok('five writes across create, guess and hub guess go through', st.join(',') === '200,200,200,200,200', st);
    ok('the sixth is refused with the guest page\'s "one moment" answer', sixth.status === 429 && sixth.body && sixth.body.error === 'rate_limited', sixth);
    ok('and was not written', d1.raw.prepare('SELECT COUNT(*) n FROM hub_guesses').get().n === 2 && d1.raw.prepare('SELECT COUNT(*) n FROM guesses').get().n === 2, d1.raw.prepare('SELECT COUNT(*) n FROM hub_guesses').get());
    const before = d1.log.length;
    for (let i = 0; i < 3; i++) await call(w, 'POST', '/api/game/' + code + '/guess', { nickname: 'E' + i, guess: 'F' }, env);
    await call(w, 'POST', '/api/hub/hubx1234/guess', { gameId: 'gm1', nickname: 'F', guess: 'F' }, env);
    ok('past the ceiling a write costs D1 nothing at all, not even a read', d1.log.length === before, d1.log.slice(before));
    /* The host's reveal is hers, proven by her hostKey: a flood of other people's guesses must never
       switch it off for the rest of the day (round-5 review NF-games-cap). */
    const rv = await call(w, 'POST', '/api/game/' + code + '/reveal', { hostKey: made.body.hostKey, result: 'F' }, env);
    ok('past the ceiling, the host\'s own reveal still goes through', rv.status === 200 && d1.raw.prepare('SELECT result FROM games WHERE code = ?').get(code).result === 'F', rv);
    const rvx = await call(w, 'POST', '/api/game/' + code + '/reveal', { hostKey: 'not-the-host-key', result: 'M' }, env);
    ok('the companion: a reveal without her hostKey is still refused, ceiling or not', rvx.status === 403 && d1.raw.prepare('SELECT result FROM games WHERE code = ?').get(code).result === 'F', rvx);
    const reads = await call(w, 'GET', '/api/game/' + code, undefined, env, {});
    ok('reads still work past it', reads.status === 200 && reads.body && reads.body.tally && reads.body.tally.F === 1, reads);

    const wc = await isolate();
    const dc = makeD1();
    const envc = Object.assign({ GAMES_DB: dc, GAMES_DAILY_CAP: '5' }, BASE_ENV);
    const g = await call(wc, 'POST', '/api/game/create', {}, envc);
    const many = await Promise.all(Array.from({ length: 40 }, (_, i) => call(wc, 'POST', '/api/game/' + g.body.code + '/guess', { nickname: 'n' + i, guess: 'M' }, envc)));
    const rows = dc.raw.prepare('SELECT COUNT(*) n FROM guesses').get().n;
    ok('forty at once with a ceiling of five: four guesses stored after the create, no more', rows === 4 && many.filter((r) => r.status === 200).length === 4, [rows, many.map((r) => r.status).join('')]);

    const wd = await isolate();
    const dd = makeD1({ throwOn: /games_writes_total/ });
    const ge = await call(wd, 'POST', '/api/game/create', {}, Object.assign({ GAMES_DB: dd }, BASE_ENV));
    ok('a D1 error on the ceiling itself answers 500, never escapes the handler', !ge.threw && ge.status === 500 && ge.body && ge.body.error === 'db_error', ge);
    const wz = await isolate();
    const dz = makeD1();
    const gz = await call(wz, 'POST', '/api/game/create', {}, Object.assign({ GAMES_DB: dz }, BASE_ENV));
    ok('with no GAMES_DAILY_CAP set, the default ceiling (5000) lets a write through', gz.status === 200, gz);
  }

  console.log('\n8. /api/step: an inherited name is not an event');
  {
    const w = await isolate();
    const d1 = makeD1();
    const env = Object.assign({ GAMES_DB: d1 }, BASE_ENV);
    for (const event of ['constructor', 'toString', '__proto__']) {
      const r = await call(w, 'POST', '/api/step', { event, props: {} }, env);
      ok(event + ' is refused as not in the plan', r.status === 400 && r.body && r.body.error === 'not_in_plan', r);
    }
    let stored = [];
    try { stored = d1.raw.prepare('SELECT key FROM funnel_steps').all().map((x) => x.key); } catch (e) { stored = []; }
    ok('and nothing was stored', stored.length === 0, stored);
    const good = await call(w, 'POST', '/api/step', { event: 'pro.sheet_viewed', props: { stage: 'baby', entry_point: 'settings' } }, env);
    ok('the companion: a real step is still counted', good.status === 204 && d1.raw.prepare('SELECT COUNT(*) n FROM funnel_steps').get().n === 1, good);
  }

  /* 9. Found by tools/fuzz_worker.js (Nov 2026): five routes called .trim() on the raw JSON value, so an
     email or token that was an object, an array, a number or a boolean threw out of the fetch handler
     and Cloudflare answered its own 500 page. Each must answer 400 bad_request instead, and the companion
     line proves the same route still reaches its real validation with a string. */
  console.log('\n9. a non-string email or token in the body is a bad request, never a throw');
  {
    const w = await isolate();
    const env = Object.assign({ GAMES_DB: makeD1(), NEWSLETTER_DB: makeD1() }, BASE_ENV);
    const ROUTES = [['/api/signin-code', 'email'], ['/api/send-signin-link', 'email'], ['/api/signin-verify', 'email'],
      ['/api/send-invite', 'email'], ['/api/send-invite', 'token'], ['/api/newsletter', 'email']];
    for (const [p, k] of ROUTES) {
      const got = [];
      for (const v of [{}, [], ['a@example.com'], 42, 1e308, true]) {
        const body = k === 'token' ? { email: 'a@example.com', token: v } : { email: v, code: '123456' };
        const r = await call(w, 'POST', p, body, env);
        got.push(r.threw ? 'threw ' + r.threw.slice(0, 60) : r.status + ' ' + (r.body && r.body.error));
      }
      ok('POST ' + p + ' with a non-string ' + k + ' answers 400 bad_request every time (object, array, number, boolean)',
        got.every((g) => g === '400 bad_request'), got);
    }
    const sane = await call(w, 'POST', '/api/signin-code', { email: 'not-an-address' }, env);
    ok('the companion: a string that is not an address still gets the route\'s own answer (invalid_email)', sane.status === 400 && sane.body && sane.body.error === 'invalid_email', sane);
    const none = await call(w, 'POST', '/api/newsletter', {}, env);
    ok('and an absent email is still invalid_email, not bad_request', none.status === 400 && none.body && none.body.error === 'invalid_email', none);
    /* The sign-in code went through String(), which throws too when the value is an object whose toString
       and valueOf are not functions ({"toString":1}). Any field a route coerces is a field a body can poison. */
    const gotCode = [];
    for (const v of [{ toString: 1 }, { toString: 1, valueOf: 1 }, [{ toString: 1 }], {}, true]) {
      const r = await call(w, 'POST', '/api/signin-verify', { email: 'a@example.com', code: v }, env);
      gotCode.push(r.threw ? 'threw ' + r.threw.slice(0, 60) : r.status + ' ' + (r.body && r.body.error));
    }
    ok('POST /api/signin-verify with a code that is not a string or a number answers 400, never throws',
      gotCode.every((g) => /^400 (bad_request|invalid_code)$/.test(g)), gotCode);
    const numCode = await call(w, 'POST', '/api/signin-verify', { email: 'a@example.com', code: 12 }, env);
    ok('the companion: a numeric code is still read as digits (too short here: invalid_code, as before)', numCode.status === 400 && numCode.body && numCode.body.error === 'invalid_code', numCode);
    const poisonEmail = await call(w, 'POST', '/api/signin-code', { email: { toString: 1 } }, env);
    ok('and an email object built to break String() is bad_request on the email routes too', poisonEmail.status === 400 && poisonEmail.body && poisonEmail.body.error === 'bad_request', poisonEmail);
  }

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'WORKER-ROUTES: FAIL' : 'WORKER-ROUTES: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
