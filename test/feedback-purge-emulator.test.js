/* The account purge's feedback deletion and its subrequest budget, driven through the REAL worker.js
 * (POST /api/account/purge) against a REAL Firestore (the emulator).
 *
 * WHY THIS EXISTS (Nov 2026 review, W3). The purge deleted a person's feedback notes with one DELETE fetch
 * per note, BEFORE the guessing-game hub cleanup. Workers Free allows 50 subrequests per invocation and
 * D1 calls count, and any signed-in user can create a feedback note carrying someone else's uid. So about
 * 38 planted notes used up the budget, the hub step threw "Too many subrequests", and her hub, its games
 * and every guest's nickname, guess and note survived her account. The purge now deletes the hubs first
 * in one D1 batch, and the notes in one documents:commit per 500. A stub cannot say whether Firestore
 * accepts that commit or what its query returns, so this asks the emulator.
 *
 * The budget is enforced here the way the platform would: every fetch and every D1 STATEMENT (a batch of
 * seven counts seven, the cautious reading) is counted, and the 51st throws "Too many subrequests.".
 * Each purge loads a fresh copy of worker.js, so it pays for Google's signing keys too.
 *
 *   cd test && npx firebase-tools emulators:exec --only firestore --project demo-cubby 'node feedback-purge-emulator.test.js'
 *   (tools/gates.js --emulator --only=feedback-purge-emu runs it on free ports)
 */
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 400) : '')); } };
const done = () => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'FEEDBACK-PURGE-EMU: FAIL' : 'FEEDBACK-PURGE-EMU: PASS');
  process.exit(fail ? 1 : 0);
};

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
if (!EMU) { console.log('  FAIL FIRESTORE_EMULATOR_HOST is not set: this test needs the Firestore emulator'); fail++; done(); }
const ROOT = path.join(__dirname, '..');
const PROJECT = 'demo-cubby', PROD = 'little-log-a9caa';
const DOCS = 'http://' + EMU + '/v1/projects/' + PROJECT + '/databases/(default)/documents';
const NAME = 'projects/' + PROJECT + '/databases/(default)/documents';
const ADMIN = { authorization: 'Bearer owner' };
const { privateKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SA = { project_id: PROD, client_email: 'cubby@' + PROD + '.iam.gserviceaccount.com', private_key: privateKey };
const idPair = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = Object.assign(idPair.publicKey.export({ format: 'jwk' }), { kid: 'test-kid', alg: 'RS256', use: 'sig' });
const b64u = (s) => Buffer.from(s).toString('base64url');
function idToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ aud: PROD, iss: 'https://securetoken.google.com/' + PROD, sub: uid, iat: now - 5, exp: now + 3600 }));
  return head + '.' + body + '.' + nodeCrypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), idPair.privateKey).toString('base64url');
}

/* The budget: every fetch the worker makes and every D1 statement it runs. */
const LIMIT = 50;
let spent = 0, overBudget = 0, perNoteDeletes = 0, commits = 0;
const spend = () => { spent++; if (spent > LIMIT) { overBudget++; throw new Error('Too many subrequests.'); } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  spend();
  let url = String(input && input.url ? input.url : input);
  const J = (o, h) => new Response(JSON.stringify(o), { headers: Object.assign({ 'content-type': 'application/json' }, h || {}) });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 't', expires_in: 3600 });
  if (url === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') return J({ keys: [JWK] }, { 'cache-control': 'max-age=3600' });
  if (!url.startsWith('https://firestore.googleapis.com/v1/')) throw new Error('unexpected fetch ' + url);
  url = url.replace('https://firestore.googleapis.com/v1/', 'http://' + EMU + '/v1/').replace('/projects/' + PROD + '/', '/projects/' + PROJECT + '/');
  const method = ((init && init.method) || 'GET').toUpperCase();
  if (method === 'DELETE' && /\/documents\/feedback\//.test(url)) perNoteDeletes++;
  if (/:commit$/.test(url)) commits++;
  return realFetch(url, Object.assign({}, init, { headers: Object.assign({}, (init && init.headers) || {}, ADMIN) }));
};
globalThis.caches = { default: { async match() { spend(); return undefined; }, async put() { spend(); } } };

/* A D1 whose every statement is a subrequest. `failFirstBatch` stages one transient D1 error on the first
   batch, which sends the hub step down its longest path (make the tables, run the batch again). */
function counted(d1, failFirstBatch) {
  let failNext = !!failFirstBatch;
  const wrap = (s) => ({
    _inner: s,
    bind: (...a) => wrap(s.bind(...a)),
    run: async () => { spend(); return s.run(); },
    first: async (c) => { spend(); return s.first(c); },
    all: async () => { spend(); return s.all(); },
  });
  return {
    prepare: (q) => wrap(d1.prepare(q)),
    batch: async (list) => {
      for (let i = 0; i < list.length; i++) spend();
      if (failNext) { failNext = false; throw new Error('D1_ERROR: staged transient failure'); }
      return d1.batch(list.map((x) => x._inner));
    },
  };
}

const commitWrites = (writes) => realFetch(DOCS + ':commit', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, ADMIN), body: JSON.stringify({ writes }) });
async function seedNotes(uid, ids) {
  for (let i = 0; i < ids.length; i += 500) {
    const r = await commitWrites(ids.slice(i, i + 500).map((id) => ({ update: { name: NAME + '/feedback/' + id, fields: {
      uid: { stringValue: uid }, email: { stringValue: 'parent@example.com' }, name: { stringValue: 'Maya' },
      ua: { stringValue: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)' }, text: { stringValue: 'note ' + id } } } })));
    if (!r.ok) throw new Error('seed commit ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
}
async function notesOf(uid) {
  const r = await realFetch(DOCS + ':runQuery', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, ADMIN),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'feedback' }], where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: uid } } } } }) });
  if (!r.ok) throw new Error('count query ' + r.status);
  return ((await r.json()) || []).filter((x) => x.document).map((x) => x.document.name.split('/').pop());
}
const clearAll = () => realFetch('http://' + EMU + '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });

(async () => {
  const { makeD1 } = await import(pathToFileURL(path.join(ROOT, 'workers', 'admin', 'dev', 'd1-sqlite.mjs')).href);
  const schema = fs.readFileSync(path.join(ROOT, 'schema', 'usage.sql'), 'utf8');
  const HER = 'uidVictim000000000000000001', OTHER = 'uidOther0000000000000000002';
  const quietly = async (fn) => {
    const logs = []; const e = console.error, l = console.log;
    console.error = (...a) => logs.push(a.join(' ')); console.log = () => {};
    try { return { out: await fn(), logs }; } finally { console.error = e; console.log = l; }
  };

  /* `notes` under her uid: her own real note, sorted last, and the rest planted with ids that sort first
     (the attack). 500 is exactly one full page, so the purge must ask once more to learn it is done. */
  const CASES = [
    { notes: 0 }, { notes: 40 }, { notes: 500 }, { notes: 1100 },
    { notes: 40, slowHubs: true }, { notes: 500, slowHubs: true },
    // More than the purge's bounded rounds (8 x 500): the purge says so, and the hubs are still gone.
    { notes: 4001, slowHubs: true, tooMany: true },
  ];
  for (const k of CASES) {
    const label = k.notes + ' feedback note' + (k.notes === 1 ? '' : 's') + (k.slowHubs ? ', hub step on its longest path' : '');
    console.log('\n' + label);
    await clearAll();
    const mine = k.notes ? Array.from({ length: k.notes - 1 }, (_, i) => '0000planted' + String(i).padStart(4, '0')).concat(['zzzzHerRealNote']) : [];
    await seedNotes(HER, mine);
    await seedNotes(OTHER, ['otherNote1', 'otherNote2', 'otherNote3']);

    const g = makeD1();
    g.raw.exec("CREATE TABLE hubs (code TEXT PRIMARY KEY, owner_uid TEXT, title TEXT, created_at INTEGER); CREATE TABLE hub_games (id TEXT PRIMARY KEY, hub_code TEXT, type TEXT, prompt TEXT, status TEXT DEFAULT 'open', result TEXT DEFAULT '', created_at INTEGER); CREATE TABLE hub_guesses (id TEXT PRIMARY KEY, game_id TEXT, hub_code TEXT, nickname TEXT, guess TEXT, note TEXT, relation TEXT, created_at INTEGER);");
    for (const [code, owner] of [['hubhers1', HER], ['hubother', OTHER]]) {
      g.raw.prepare("INSERT INTO hubs VALUES (?, ?, 'Boy or girl?', 1)").run(code, owner);
      g.raw.prepare("INSERT INTO hub_games VALUES (?, ?, 'sex', '?', 'open', '', 1)").run('g_' + code, code);
      g.raw.prepare("INSERT INTO hub_guesses VALUES (?, ?, ?, 'Auntie Sam', 'girl', 'cannot wait', 'aunt', 1)").run('q1_' + code, 'g_' + code, code);
      g.raw.prepare("INSERT INTO hub_guesses VALUES (?, ?, ?, 'Grandpa Joe', 'boy', '', 'grandparent', 1)").run('q2_' + code, 'g_' + code, code);
    }
    const u = makeD1(); u.raw.exec(schema);
    u.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES ('2026-11-15', ?, 'hh1', 'browser', 'visits', '', 1)").run(HER);
    u.raw.prepare("INSERT INTO devices (device, uid, platform, os, browser, app_version, first_seen, last_seen) VALUES ('d_her000000001', ?, 'browser', 'macOS', 'Safari', 'v369', 1, 1)").run(HER);

    spent = 0; overBudget = 0; perNoteDeletes = 0; commits = 0;
    const w = (await import(pathToFileURL(path.join(ROOT, 'worker.js')).href + '?case=' + Math.random())).default;
    const env = { GAMES_DB: counted(g, k.slowHubs), USAGE_DB: counted(u), FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
    const { out: res, logs } = await quietly(async () => {
      const r = await w.fetch(new Request('https://little-cubby.com/api/account/purge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: idToken(HER) }) }), env, { waitUntil() {} });
      let body = null; try { body = await r.json(); } catch (e) {}
      return { status: r.status, body };
    });
    const left = await notesOf(HER), others = await notesOf(OTHER);
    const hub = (sql) => g.raw.prepare(sql).get().c;

    ok('[' + label + '] stays within the 50-subrequest budget, every D1 statement counted (' + spent + ' used)', spent <= LIMIT && overBudget === 0, { spent, overBudget });
    ok('[' + label + '] her hub, its game and every guest\'s guess are gone', hub("SELECT COUNT(*) AS c FROM hubs WHERE code = 'hubhers1'") === 0
      && hub("SELECT COUNT(*) AS c FROM hub_games WHERE hub_code = 'hubhers1'") === 0 && hub("SELECT COUNT(*) AS c FROM hub_guesses WHERE hub_code = 'hubhers1'") === 0,
      { hubs: hub("SELECT COUNT(*) AS c FROM hubs WHERE code = 'hubhers1'"), guesses: hub("SELECT COUNT(*) AS c FROM hub_guesses WHERE hub_code = 'hubhers1'"), logs });
    ok('[' + label + '] companion: another person\'s hub and guests stay', hub("SELECT COUNT(*) AS c FROM hub_guesses WHERE hub_code = 'hubother'") === 2 && hub("SELECT COUNT(*) AS c FROM hubs WHERE code = 'hubother'") === 1);
    ok('[' + label + '] her usage rows are gone', u.raw.prepare('SELECT COUNT(*) AS c FROM usage_daily WHERE uid = ?').get(HER).c === 0 && u.raw.prepare('SELECT COUNT(*) AS c FROM devices WHERE uid = ?').get(HER).c === 0);
    ok('[' + label + '] companion: the other person\'s notes stay', others.length === 3, others);
    ok('[' + label + '] notes go by documents:commit, 500 to a commit, never one DELETE per note', perNoteDeletes === 0 && commits === Math.min(8, Math.ceil(mine.length / 500)), { perNoteDeletes, commits });
    if (!k.tooMany) {
      ok('[' + label + '] Firestore really deleted every one of her notes, her own real one included', left.length === 0, { left: left.length, sample: left.slice(-3) });
      ok('[' + label + '] and the purge answers ok', res.status === 200 && res.body && res.body.ok === true && res.body.hubs === 1, { res, logs });
    } else {
      ok('[' + label + '] past the bounded rounds the rest stays, and only the rest (' + left.length + ' left)', left.length === mine.length - 8 * 500, left.length);
      ok('[' + label + '] and the purge says so: 500 and a logged code, never a silent ok', res.status === 500 && logs.some((l) => /purge_feedback_fail/.test(l)), { res, logs });
    }
  }
  await clearAll();
  done();
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); fail++; done(); });
