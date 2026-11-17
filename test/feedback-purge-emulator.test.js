/* The account purge's feedback deletion and its subrequest budget, driven through the REAL worker.js
 * (POST /api/account/purge) against a REAL Firestore (the emulator), with a person whose usage rows are more
 * than one erasure step (ERASE-CHUNK) among the cases. And, last, the household purge's shell (ERA-SK-1,
 * RE-SK-4, Nov 2026): when cubby-usage refuses the pending-erasure marker, the family's document is cut down
 * to a shell by a documents:batchWrite whose writes carry their own preconditions, which only a real
 * Firestore can judge; a family's shell is written before a heavy family after it can use up the tick's 50
 * subrequests (SK2-1); stuck shells, however many, never keep a household that falls due from being found,
 * with every tick inside the 50-subrequest budget; and once cubby-usage answers again, shells due ahead of a
 * family never keep it waiting a tick (SE-V6).
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
let limit = LIMIT;   // raised only while the stuck-shell section stages its shells
let spent = 0, overBudget = 0, perNoteDeletes = 0, commits = 0;
let beforeCommit = null;   // the household shell: something writes the household between the read and the shell
const spend = () => { spent++; if (spent > limit) { overBudget++; throw new Error('Too many subrequests.'); } };
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
  if (/:(commit|batchWrite)$/.test(url) && beforeCommit) { const f = beforeCommit; beforeCommit = null; await f(); }
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
    /* More usage rows than one erasure step (ERASE-CHUNK): the step runs inside the budget, and the rest is
       on record for the cron. Every usage table holds rows, so the step runs every one of its statements. */
    { notes: 500, slowHubs: true, heavyUsage: true },
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
    if (k.heavyUsage) {
      u.raw.exec('BEGIN');
      const ev = u.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,role,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-11-15', 5, 'UTC', ?, 'hh1', 'owner', 'd_her000000001', ?, 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{}')");
      for (let i = 0; i < 1500; i++) ev.run(HER, 'ev' + i, Date.now() - i, Date.now() - i, HER, 'v_h' + Math.floor(i / 5));
      u.raw.prepare("INSERT INTO membership (uid, hid, role, notice, checked_at) VALUES (?, 'hh1', 'owner', '', 1)").run(HER);
      u.raw.prepare("INSERT INTO nudges (id, hid, uid, channel, template, body, sent_by, state, at) VALUES ('n_her1', 'hh1', ?, 'note', 't', 'b', 'Saurav', 'sent', 1)").run(HER);
      u.raw.prepare("INSERT INTO shared_entries (id, hid, shared_by, entry_id, entry, at, expires_at) VALUES ('s_her1', 'hh1', ?, 'e1', '{}', 1, 2)").run(HER);
      u.raw.exec('COMMIT');
    }
    const usageOfHer = () => ['usage_events', 'usage_daily', 'devices', 'membership', 'nudges'].reduce((a, t) => a + u.raw.prepare('SELECT COUNT(*) AS c FROM ' + t + ' WHERE uid = ?').get(HER).c, 0)
      + u.raw.prepare('SELECT COUNT(*) AS c FROM shared_entries WHERE shared_by = ?').get(HER).c;
    const usageBefore = usageOfHer();

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
    if (!k.heavyUsage) ok('[' + label + '] her usage rows are gone', usageOfHer() === 0, usageOfHer());
    else {
      const pending = u.raw.prepare('SELECT COUNT(*) AS c FROM usage_meta WHERE key = ?').get('erase_uid:' + HER).c;
      ok('[' + label + '] (staged: ' + usageBefore + ' usage rows of hers, in every usage table)', usageBefore === 1505, usageBefore);
      ok('[' + label + '] the purge\'s erasure step takes at most one step\'s rows, inside the budget, and puts the rest on record for the cron', usageBefore - usageOfHer() > 0
        && usageBefore - usageOfHer() <= 1000 && usageOfHer() > 0 && pending === 1 && u.raw.prepare('SELECT COUNT(*) AS c FROM membership WHERE uid = ?').get(HER).c === 0, { gone: usageBefore - usageOfHer(), pending });
    }
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

  /* ---- The household purge when cubby-usage refuses the marker (ERA-SK-1, RE-SK-4) ----
     The purge writes a pending-erasure marker to cubby-usage before the household document goes. When D1
     refuses it (the account's daily write limit, say), the family's data must still go on time: the
     document becomes a shell of deleteAfter, deletionRequestedBy, ownerId and purgeShell, replaced whole by
     a documents:batchWrite whose write carries its updateTime precondition, with deleteAfter an hour on.
     Firestore decides here whether that replace really drops every other field, and whether the precondition
     really refuses a stale write (and refuses only that one write). The clock is the worker's Date.now,
     pinned for this section to a day and an hour (Sunday 22 November 2026, 06:00 UTC) and moved on by hand. */
  const realNow = Date.now;
  let clock = Date.UTC(2026, 10, 22, 6, 0, 0);
  Date.now = () => clock;
  const MIN = 60000;
  const mod = await import(pathToFileURL(path.join(ROOT, 'worker.js')).href + '?shell=' + Math.random());
  const purge = mod.__purge && mod.__purge.purgeDeletedHouseholds;
  const getHh = async (hid) => { const r = await realFetch(DOCS + '/households/' + hid, { headers: ADMIN }); return r.ok ? (await r.json()).fields || {} : null; };
  const kids = async (hid) => { const r = await realFetch(DOCS + '/households/' + hid + '/events', { headers: ADMIN }); return r.ok ? ((await r.json()).documents || []).length : -1; };
  const family = (due, extra) => Object.assign({ deleteAfter: { integerValue: String(due) }, deletionRequestedBy: { stringValue: 'uidGone0000000000000000009' },
    ownerId: { stringValue: 'uidGone0000000000000000009' }, members: { mapValue: {} },
    app: { mapValue: { fields: { babies: { stringValue: 'Maya, born 2 May' }, medicines: { stringValue: 'Calpol 2.5ml' } } } },
    memberInfo: { mapValue: { fields: { uidGone0000000000000000009: { mapValue: { fields: { name: { stringValue: 'Sam' } } } } } } } }, extra || {});
  const SHELL_KEYS = 'deleteAfter,deletionRequestedBy,ownerId,purgeShell';
  {
    console.log('\nhousehold purge, cubby-usage refusing the marker');
    await clearAll();
    ok('worker.js exports __purge.purgeDeletedHouseholds', typeof purge === 'function');
    let refusing = true, d1Calls = 0;
    const u = makeD1({ hooks: { before() { d1Calls++; if (refusing) throw new Error('D1_ERROR: staged, the account is over its daily writes'); } } });
    u.raw.exec(schema);
    const seedHh = async (hid) => {
      const r = await commitWrites([{ update: { name: NAME + '/households/' + hid, fields: family(clock - 1000) } },
        { update: { name: NAME + '/households/' + hid + '/events/e1', fields: { type: { stringValue: 'feed' }, amount: { integerValue: '120' } } } }]);
      if (!r.ok) throw new Error('seed household ' + r.status);
      u.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES ('2026-11-15', ?, ?, 'browser', 'visits', '', 1)").run('uidCarer' + hid, hid);
    };
    const usageLeft = (hid) => u.raw.prepare('SELECT COUNT(*) AS c FROM usage_daily WHERE hid = ?').get(hid).c;
    const pendingN = () => u.raw.prepare("SELECT COUNT(*) AS c FROM usage_meta WHERE key >= 'erase_hid:' AND key < 'erase_hid;'").get().c;
    await seedHh('hhShell01');
    await seedHh('hhShell02');
    const ENV = { USAGE_DB: counted(u), FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };   // every D1 statement is a subrequest too

    // hhShell02 is written between the purge's read and its shell write: the precondition must refuse it.
    let raced = 0;
    beforeCommit = async () => {
      raced++;
      const r = await commitWrites([{ update: { name: NAME + '/households/hhShell02', fields: family(clock - 1000, { app: { mapValue: { fields: { babies: { stringValue: 'newer' } } } } }) } }]);
      if (!r.ok) throw new Error('race write ' + r.status);
    };
    spent = 0; overBudget = 0; commits = 0; d1Calls = 0;
    const t1 = await quietly(() => purge(ENV));
    beforeCommit = null;
    const s1 = await getHh('hhShell01'), r2 = await getHh('hhShell02');
    ok('(staged: D1 refused the marker, and was asked once that tick, not once a household)', t1.logs.filter((l) => /purge_usage_mark_fail/.test(l)).length === 1 && d1Calls === 1, { d1Calls, logs: t1.logs });
    ok('the family\'s data is gone at once: Firestore holds a shell of exactly deleteAfter, deletionRequestedBy, ownerId and purgeShell', !!s1 && Object.keys(s1).sort().join() === SHELL_KEYS,
      s1 && Object.keys(s1));
    ok('with who asked kept, and deleteAfter an hour on, so a stuck shell waits out of the purge query\'s way (RE-SK-4)', !!s1 && !!s1.deleteAfter && Number(s1.deleteAfter.integerValue) === clock + 60 * MIN
      && s1.deletionRequestedBy.stringValue === 'uidGone0000000000000000009' && s1.purgeShell.booleanValue === true, s1);
    ok('and its subcollections are gone', (await kids('hhShell01')) === 0, await kids('hhShell01'));
    ok('the precondition is real: a household written since the read keeps that write, the refusal is logged, and the other shell still lands', raced === 1 && !!r2 && r2.app && r2.app.mapValue.fields.babies.stringValue === 'newer'
      && t1.logs.some((l) => /purge_shell_fail hhShell02/.test(l)) && !t1.logs.some((l) => /purge_shell_fail hhShell01/.test(l)), { keys: r2 && Object.keys(r2), logs: t1.logs });
    ok('nothing went from cubby-usage yet, and no subrequest budget was passed (' + spent + ' used)', usageLeft('hhShell01') === 1 && pendingN() === 0 && overBudget === 0 && spent <= LIMIT, { left: usageLeft('hhShell01'), spent });

    // The next tick, D1 still refusing: the raced household is cut down too; the first shell is not due yet.
    clock += 15 * MIN; spent = 0;
    await quietly(() => purge(ENV));
    const s2 = await getHh('hhShell02');
    ok('the next tick cuts the raced household down to its shell as well', !!s2 && Object.keys(s2).sort().join() === SHELL_KEYS, s2 && Object.keys(s2));

    // D1 answers again; an hour and a quarter on, both shells are due: they go, with their usage rows.
    refusing = false;
    clock += 60 * MIN; spent = 0;
    const t3 = await quietly(() => purge(ENV));
    ok('once D1 answers and the shells come due, the tick deletes both', (await getHh('hhShell01')) === null && (await getHh('hhShell02')) === null && t3.out && t3.out.households === 2, { out: t3.out, logs: t3.logs });
    ok('and their usage rows, and clears the markers', usageLeft('hhShell01') === 0 && usageLeft('hhShell02') === 0 && pendingN() === 0, { left: [usageLeft('hhShell01'), usageLeft('hhShell02')], pending: pendingN() });
  }

  /* ---- A light family due before a heavy one, cubby-usage refusing (SK2-1) ----
     Two families fall due in one tick while cubby-usage refuses the marker. The light one is due first: three
     events, gone in a dozen subrequests. The heavy one after it has 120 events, more than the rest of the 50
     subrequests can delete (one document per log entry, so thousands is an ordinary family), so that tick
     ends past the budget, every later call throwing. The light family's shell must already be written by
     then: a shell that waits for the end of the tick never lands, its deleteAfter never moves, and the next
     ticks repeat it until the heavy family's last child is gone, its app blob and members kept in Firestore
     past the date the family was promised (ERA-SK-1). Pinned: Sunday 22 November 2026, 11:00 UTC, then each
     quarter of an hour. */
  {
    console.log('\nhousehold purge, cubby-usage refusing, a light family due before a heavy one');
    await clearAll();
    clock = Date.UTC(2026, 10, 22, 11, 0, 0);
    let d1Calls = 0;
    const u = makeD1({ hooks: { before() { d1Calls++; throw new Error('D1_ERROR: staged, the account is over its daily writes'); } } });
    const ENV = { USAGE_DB: counted(u), FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
    const HEAVY = 120;
    const writes = [{ update: { name: NAME + '/households/hhLight', fields: family(clock - 120 * MIN) } }];
    for (let i = 0; i < 3; i++) writes.push({ update: { name: NAME + '/households/hhLight/events/e' + i, fields: { type: { stringValue: 'feed' } } } });
    writes.push({ update: { name: NAME + '/households/hhHeavy', fields: family(clock - 60 * MIN) } });
    for (let i = 0; i < HEAVY; i++) writes.push({ update: { name: NAME + '/households/hhHeavy/events/e' + String(i).padStart(4, '0'), fields: { type: { stringValue: 'feed' } } } });
    const r = await commitWrites(writes);
    if (!r.ok) throw new Error('seed light and heavy ' + r.status);
    const keysOf = async (hid) => { const f = await getHh(hid); return f ? Object.keys(f).sort().join() : null; };
    const events = async (hid) => { const x = await realFetch(DOCS + '/households/' + hid + '/events?pageSize=300', { headers: ADMIN }); return x.ok ? ((await x.json()).documents || []).length : -1; };
    spent = 0; overBudget = 0; d1Calls = 0;
    await quietly(() => purge(ENV));
    const t1 = { light: await keysOf('hhLight'), lightEvents: await events('hhLight'), heavy: await keysOf('hhHeavy'), heavyEvents: await events('hhHeavy'), spent, overBudget, d1Calls };
    ok('a light family due first is cut down to its shell on that tick, though the heavy family after it uses up the 50 subrequests (SK2-1)',
      t1.light === SHELL_KEYS && t1.lightEvents === 0, t1);
    ok('companion: the heavy family did use up that tick, and keeps its family data while any child of it is left', t1.overBudget > 0 && t1.heavyEvents > 0 && t1.heavyEvents < HEAVY
      && /(^|,)app(,|$)/.test(String(t1.heavy)) && /(^|,)members(,|$)/.test(String(t1.heavy)), t1);
    const ticks = [];
    for (let k = 1; k <= 4 && (await keysOf('hhHeavy')) !== SHELL_KEYS; k++) {
      clock += 15 * MIN; spent = 0; overBudget = 0;
      await quietly(() => purge(ENV));
      ticks.push({ at: new Date(clock).toISOString().slice(11, 16), spent, overBudget, heavyEvents: await events('hhHeavy') });
    }
    ok('and the heavy family is a shell too once its last child is gone, within the hour (11:15 to 12:00 UTC)', (await keysOf('hhHeavy')) === SHELL_KEYS && (await events('hhHeavy')) === 0, ticks);
    ok('the light family\'s shell is out of the way meanwhile: written once, due again only an hour on', (await keysOf('hhLight')) === SHELL_KEYS
      && Number((await getHh('hhLight')).deleteAfter.integerValue) === Date.UTC(2026, 10, 22, 12, 0, 0), await getHh('hhLight'));
  }

  /* ---- 55 stuck shells and a household falling due (RE-SK-4) ----
     cubby-usage refuses for hours (say it was bound before schema/usage.sql was applied). The purge query
     returns at most 50 households, oldest deleteAfter first. 55 households fall due and become shells; then
     a family's household falls due, later than all of them. It must be found and emptied on its first tick,
     and a second one, falling due just after the shells come due again, within two ticks. Every tick of it
     must stay inside the 50 subrequests the cron has, every D1 statement and Firestore call counted.
     Before: a shell kept its deleteAfter, so 50 old shells stayed first in the query for as long as D1
     refused, and each one listed its seven empty subcollections and wrote itself, so five of them used up
     the tick. Pinned: Sunday 22 November 2026, from 09:00 UTC. */
  {
    console.log('\nhousehold purge, 55 stuck shells');
    await clearAll();
    clock = Date.UTC(2026, 10, 22, 9, 0, 0);
    let d1Calls = 0;
    const u = makeD1({ hooks: { before() { d1Calls++; throw new Error('D1_ERROR: staged, no such table'); } } });
    const ENV = { USAGE_DB: counted(u), FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };   // every D1 statement is a subrequest too
    const T0 = clock;
    const writes = [];
    for (let i = 0; i < 55; i++) writes.push({ update: { name: NAME + '/households/hhStuck' + String(i).padStart(2, '0'), fields: family(T0 - 100 * MIN + i) } });
    for (let i = 0; i < writes.length; i += 500) { const r = await commitWrites(writes.slice(i, i + 500)); if (!r.ok) throw new Error('seed shells ' + r.status); }
    const keysOf = async (hid) => { const f = await getHh(hid); return f ? Object.keys(f).sort().join() : null; };
    const shellsNow = async () => { let n = 0; for (let i = 0; i < 55; i++) if ((await keysOf('hhStuck' + String(i).padStart(2, '0'))) === SHELL_KEYS) n++; return n; };
    // Staging, with the budget lifted: two ticks a quarter of an hour apart make all 55 into shells.
    limit = 100000;
    await quietly(() => purge(ENV));
    clock += 15 * MIN;
    await quietly(() => purge(ENV));
    limit = LIMIT;
    ok('(staged: 55 households, all of them shells now, D1 refusing throughout)', (await shellsNow()) === 55, await shellsNow());

    // A family's household falls due after every shell's original deleteAfter. The budget is the real one.
    const due1 = clock + 4 * MIN;
    const r1 = await commitWrites([{ update: { name: NAME + '/households/hhFamily01', fields: family(due1) } },
      { update: { name: NAME + '/households/hhFamily01/events/e1', fields: { type: { stringValue: 'feed' } } } }]);
    if (!r1.ok) throw new Error('seed family ' + r1.status);
    clock += 15 * MIN; spent = 0; overBudget = 0; d1Calls = 0;
    await quietly(() => purge(ENV));
    ok('with more than 50 stuck shells, a household that falls due is found and emptied on its first tick (RE-SK-4)', (await keysOf('hhFamily01')) === SHELL_KEYS && (await kids('hhFamily01')) === 0,
      { keys: await keysOf('hhFamily01'), kids: await kids('hhFamily01') });
    ok('inside the 50-subrequest budget (' + spent + ' used)', overBudget === 0 && spent <= LIMIT, { spent, overBudget });

    // An hour on, all 55 shells are due again, and a second household falls due after every one of them.
    clock = T0 + 15 * MIN + 61 * MIN;
    const due2 = clock - 1000;
    const r2 = await commitWrites([{ update: { name: NAME + '/households/hhFamily02', fields: family(due2) } },
      { update: { name: NAME + '/households/hhFamily02/events/e1', fields: { type: { stringValue: 'feed' } } } }]);
    if (!r2.ok) throw new Error('seed family ' + r2.status);
    const ticks = [];
    for (let k = 0; k < 2 && (await keysOf('hhFamily02')) !== SHELL_KEYS; k++) {
      spent = 0; overBudget = 0; d1Calls = 0;
      await quietly(() => purge(ENV));
      ticks.push({ spent, overBudget, d1Calls });
      clock += 15 * MIN;
    }
    ok('with 55 shells due at once, a household falling due after them is emptied within two ticks (RE-SK-4)', (await keysOf('hhFamily02')) === SHELL_KEYS && (await kids('hhFamily02')) === 0, ticks);
    ok('every one of those ticks inside the budget, asking D1 once (' + ticks.map((t) => t.spent).join(', ') + ' used)', ticks.length > 0 && ticks.every((t) => t.overBudget === 0 && t.spent <= LIMIT && t.d1Calls === 1), ticks);
    ok('companion: the shells were due and in the way: the first of those ticks found 50 of them before the household', ticks.length === 2, ticks);
  }

  /* ---- Shells due ahead of a family, cubby-usage answering again (SE-V6) ----
     Once D1 answers, finishing a shell costs about a dozen subrequests (its marker, a last look at its seven
     subcollections, the delete, its usage step), so a tick finishes three or four. Six shells fell due an
     hour before a family's household did, and the purge query returns all seven, shells first. The purge
     takes real households before shells, so the family's household must be emptied, its usage rows with it,
     on that tick, whatever the budget leaves for the shells. Every D1 statement and Firestore call is
     counted; past 50 each one throws, as on the platform. Pinned: Sunday 22 November 2026, 14:00 UTC, then
     14:15 and 14:30. */
  {
    console.log('\nhousehold purge, D1 answering again, shells due ahead of a family');
    await clearAll();
    clock = Date.UTC(2026, 10, 22, 14, 0, 0);
    const u = makeD1(); u.raw.exec(schema);
    const ENV = { USAGE_DB: counted(u), FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
    const SHELLS = Array.from({ length: 6 }, (_, i) => 'hhDue' + i);
    const shellOf = (due) => ({ deleteAfter: { integerValue: String(due) }, deletionRequestedBy: { stringValue: 'uidGone0000000000000000009' },
      ownerId: { stringValue: 'uidGone0000000000000000009' }, purgeShell: { booleanValue: true } });
    const writes = SHELLS.map((h, i) => ({ update: { name: NAME + '/households/' + h, fields: shellOf(clock - 60 * MIN + i) } }));
    writes.push({ update: { name: NAME + '/households/hhFamily03', fields: family(clock - 1000) } },
      { update: { name: NAME + '/households/hhFamily03/events/e1', fields: { type: { stringValue: 'feed' } } } });
    const r = await commitWrites(writes);
    if (!r.ok) throw new Error('seed shells and family ' + r.status);
    for (const h of SHELLS.concat(['hhFamily03'])) u.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES ('2026-11-21', ?, ?, 'browser', 'visits', '', 1)").run('uidCarer' + h, h);
    const usageOf = (h) => u.raw.prepare('SELECT COUNT(*) AS c FROM usage_daily WHERE hid = ?').get(h).c;
    const shellsLeft = async () => { let n = 0; for (const h of SHELLS) if ((await getHh(h)) !== null) n++; return n; };
    spent = 0; overBudget = 0;
    await quietly(() => purge(ENV));
    const left1 = await shellsLeft();
    ok('with six shells due ahead of it and D1 answering, a family\'s household is emptied on that tick, its usage rows with it (SE-V6)',
      (await getHh('hhFamily03')) === null && (await kids('hhFamily03')) === 0 && usageOf('hhFamily03') === 0, { doc: await getHh('hhFamily03'), usage: usageOf('hhFamily03'), spent });
    ok('companion: the shells were in the way: that tick\'s 50 subrequests could not finish all six (' + left1 + ' left)', left1 > 0 && overBudget > 0, { left1, spent, overBudget });
    for (let k = 1; k <= 2; k++) { clock += 15 * MIN; spent = 0; overBudget = 0; await quietly(() => purge(ENV)); }
    const onRecord = (h) => u.raw.prepare('SELECT COUNT(*) AS c FROM usage_meta WHERE key = ?').get('erase_hid:' + h).c === 1;
    ok('and the next two ticks finish them, each one\'s usage rows gone or on record for the cron (14:30 UTC)', (await shellsLeft()) === 0 && SHELLS.every((h) => usageOf(h) === 0 || onRecord(h)),
      { left: await shellsLeft(), usage: SHELLS.map((h) => usageOf(h) + (onRecord(h) ? '+marker' : '')) });
  }
  Date.now = realNow;
  await clearAll();
  done();
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); fail++; done(); });
