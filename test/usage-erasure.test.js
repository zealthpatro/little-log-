/* usage-erasure: a deleted person or household leaves no usage row, and old rows age out on time.
 *
 *   node test/usage-erasure.test.js
 *   node test/usage-erasure.test.js --self-test   (break each erasure in a temp copy; each must be caught)
 *
 * Spec §10 and §14 (usage-erasure), plus the /api/usage route itself (§8.7). This imports the REAL
 * worker.js and drives its fetch handler and its cron over real SQLite, with Google's token, JWK,
 * Firestore and Auth endpoints stubbed at fetch. Clock-pinned checks pin the day AND the hour.
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
const AUTH = 'https://identitytoolkit.googleapis.com/v1/projects/' + PROJECT + '/accounts:lookup';
const SA = { project_id: PROJECT, client_email: 'cubby@' + PROJECT + '.iam.gserviceaccount.com',
  private_key: nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey };
const idPair = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = Object.assign(idPair.publicKey.export({ format: 'jwk' }), { kid: 'test-kid', alg: 'RS256', use: 'sig' });
const b64u = (s) => Buffer.from(s).toString('base64url');
function idToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ aud: PROJECT, iss: 'https://securetoken.google.com/' + PROJECT, sub: uid, iat: now - 5, exp: now + 3600 }));
  return head + '.' + body + '.' + nodeCrypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), idPair.privateKey).toString('base64url');
}

/* The world outside our code. */
const docs = new Map();
let authKnown = new Set(), authFails = false;
let dueHouseholds = [];
const deletedDocs = [];
let commits = [], perNoteDeletes = 0;   // feedback: each documents:commit's write count, and any one-note DELETE
const batchWrites = [];                 // each documents:batchWrite's write count (the household shells)
const shellWrites = [], docTimes = new Map();   // household shells written, and each document's updateTime
let docClock = 0;
/* The platform's subrequest budget, staged: once a fetch matches `budgetGoneAt`, it and every fetch after it
   throw, as Workers do past 50 in one invocation. */
let budgetGoneAt = null, budgetGone = false;
const docTime = (p) => docTimes.get(p) || '2026-11-01T00:00:00Z';
const J = (o, s, h) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'content-type': 'application/json' }, h || {}) });
globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const method = ((init && init.method) || 'GET').toUpperCase();
  if (budgetGone || (budgetGoneAt && budgetGoneAt.test(url))) { budgetGone = true; throw new Error('Too many subrequests.'); }
  if (url.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 'tok', expires_in: 3600 });
  if (url === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') return J({ keys: [JWK] }, 200, { 'cache-control': 'max-age=3600' });
  if (url === AUTH) {
    if (authFails) return J({ error: 'boom' }, 503);
    const ids = JSON.parse(init.body).localId || [];
    return J({ users: ids.filter((u) => authKnown.has(u)).map((u) => ({ localId: u })) });
  }
  if (url === FS + ':runQuery' && method === 'POST') {
    const q = JSON.parse(init.body).structuredQuery;
    const coll = q.from[0].collectionId, want = q.where.fieldFilter.value.stringValue;
    // The cron's household purge asks for households whose deleteAfter has passed.
    if (coll === 'households' && q.where.fieldFilter.field.fieldPath === 'deleteAfter') {
      /* As Firestore answers it: only a document whose deleteAfter is at or before the query's value, oldest
         first, at most `limit`, holding just the fields the query selects. So a shell that lost deleteAfter,
         or whose deleteAfter moved past now, is not found. `dueHouseholds` names the households a section
         puts in play. */
      const sel = ((q.select && q.select.fields) || []).map((x) => x.fieldPath);
      const by = Number(q.where.fieldFilter.value.integerValue);
      const due = (h) => { const f = docs.get('households/' + h); return f && f.deleteAfter ? Number(f.deleteAfter.integerValue) : null; };
      const hits = dueHouseholds.filter((h) => due(h) !== null && due(h) <= by).sort((a, b) => due(a) - due(b)).slice(0, q.limit || 300);
      return J(hits.map((h) => {
        const all = Object.assign({ ownerId: { stringValue: 'uidGone' }, members: { mapValue: {} } }, docs.get('households/' + h));
        const fields = {}; for (const k of sel) if (all[k]) fields[k] = all[k];
        return { document: { name: 'projects/' + PROJECT + '/databases/(default)/documents/households/' + h, fields, updateTime: docTime('households/' + h) } };
      }));
    }
    if (!want) return J([]);
    return J([...docs.entries()].filter(([p, f]) => p.startsWith(coll + '/') && f.uid && f.uid.stringValue === want).map(([p]) => ({ document: { name: 'projects/' + PROJECT + '/databases/(default)/documents/' + p } })));
  }
  /* An update of a household, with its precondition honoured, as Firestore does it: with no updateMask the
     whole document is replaced (every other field goes); with one, only the named fields change. Answers
     false when the precondition refuses it. The household shell (ERA-SK-1, RE-SK-4) goes by batchWrite;
     test/feedback-purge-emulator.test.js proves the same writes against a real Firestore. */
  const updateHousehold = (wr) => {
    const p = decodeURIComponent(wr.update.name.split('/documents/')[1]);
    const pre = wr.currentDocument || {};
    if ((pre.updateTime && (!docs.has(p) || pre.updateTime !== docTime(p))) || (pre.exists === true && !docs.has(p))) return false;   // a document gone fails an updateTime precondition too
    let next = wr.update.fields || {};
    if (wr.updateMask) {
      next = Object.assign({}, docs.get(p) || {});
      for (const k of wr.updateMask.fieldPaths || []) { if (wr.update.fields && wr.update.fields[k]) next[k] = wr.update.fields[k]; else delete next[k]; }
    }
    shellWrites.push(p); docs.set(p, next); docTimes.set(p, '2026-11-16T' + String(++docClock).padStart(2, '0') + ':00:00Z');
    return true;
  };
  if (url === FS + ':batchWrite' && method === 'POST') {
    const writes = JSON.parse(init.body).writes || [];
    batchWrites.push(writes.length);
    const status = writes.map((wr) => {
      if (!(wr.update && /\/documents\/households\//.test(wr.update.name))) throw new Error('unstubbed batchWrite write: ' + JSON.stringify(wr).slice(0, 80));
      return updateHousehold(wr) ? {} : { code: 9, message: 'FAILED_PRECONDITION' };
    });
    return J({ writeResults: writes.map(() => ({})), status });
  }
  if (url === FS + ':commit' && method === 'POST') {
    const writes = JSON.parse(init.body).writes || [];
    commits.push(writes.length);
    for (const wr of writes) {
      if (wr.update && /\/documents\/households\//.test(wr.update.name)) {
        if (!updateHousehold(wr)) return J({ error: { status: 'FAILED_PRECONDITION' } }, 400);
        continue;
      }
      if (!wr.delete) throw new Error('unstubbed commit write: ' + JSON.stringify(wr).slice(0, 80));
      const p = decodeURIComponent(wr.delete.split('/documents/')[1]);
      deletedDocs.push(p); docs.delete(p);
    }
    return J({ writeResults: writes.map(() => ({})) });
  }
  if (url.startsWith('https://firestore.googleapis.com/v1/projects/') && method === 'DELETE') {
    const p = decodeURIComponent(url.split('/documents/')[1]);
    if (p.startsWith('feedback/')) perNoteDeletes++;
    deletedDocs.push(p); docs.delete(p); return J({});
  }
  if (url.startsWith(FS + '/') && method === 'GET') {
    const p = decodeURIComponent(url.slice(FS.length + 1).split('?')[0]);
    return docs.has(p) ? J({ name: FS + '/' + p, fields: docs.get(p) }) : J({ error: { status: 'NOT_FOUND' } }, 404);
  }
  throw new Error('unstubbed external call: ' + method + ' ' + url);
};
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

/* The cron reads the clock itself (usageMaintenance falls back to Date.now()). Every cron call here runs on
   a pinned clock, the DAY and the hour: Monday 16 November 2026, 06:00 UTC. Monday, so the weekly orphan
   sweep never joins in; mid-morning, so no run straddles midnight. */
const CRON_NOW = Date.UTC(2026, 10, 16, 6, 0, 0);
const CRON_DAY = '2026-11-16';
async function atCronClock(fn) {
  const real = Date.now;
  Date.now = () => CRON_NOW;
  try { return await fn(); } finally { Date.now = real; }
}
/* The same, at another pinned instant. Every caller below names its day AND hour. */
async function atClock(t, fn) {
  const real = Date.now;
  Date.now = () => t;
  try { return await fn(); } finally { Date.now = real; }
}
const DAY_MS = 86400000, MIN_MS = 60000;

/* `opts.hh`: also run the household erasure checked at every step (about fifteen seconds).
   `opts.sim`: also run the long steady-state simulation (about two seconds). The plain run and the
   self-test's control and its allowance mutant do; the other mutants are caught by the short checks. */
async function suite(workerFile, quiet, opts) {
  opts = opts || {};
  let pass = 0, fail = 0;
  const failed = [];
  const ok = (n, c, x) => { if (c) pass++; else { fail++; failed.push(n); if (!quiet) console.log('  FAIL ' + n + (x !== undefined ? '\n       ' + JSON.stringify(x).slice(0, 400) : '')); } };
  /* The stubbed world starts empty for every run: the self-test runs the suite many times in one process,
     and a count or a deleted-document list left by an earlier run would let a later check pass for free. */
  commits.length = 0; batchWrites.length = 0; perNoteDeletes = 0; deletedDocs.length = 0; shellWrites.length = 0; docTimes.clear(); docClock = 0;
  dueHouseholds = []; authKnown = new Set(); authFails = false; budgetGoneAt = null; budgetGone = false;
  const wmod = await import('file://' + workerFile + '?' + Math.random());
  const w = wmod.default;
  // core.mjs from the SAME tree as the worker, so a core mutant in a temp tree is the one both run.
  const core = await import('file://' + path.join(path.dirname(workerFile), 'workers', 'usage', 'core.mjs'));
  const { makeD1 } = await import('file://' + path.join(ROOT, 'workers', 'admin', 'dev', 'd1-sqlite.mjs'));
  const schema = fs.readFileSync(path.join(ROOT, 'schema', 'usage.sql'), 'utf8');
  const fresh = () => { const db = makeD1(); db.raw.exec(schema); return db; };
  const count = (db, t, where) => db.raw.prepare('SELECT COUNT(*) AS c FROM ' + t + (where ? ' WHERE ' + where : '')).get().c;
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const errs = [];
  const realErr = console.error, realLog = console.log;
  console.error = (...a) => errs.push(a.join(' '));
  console.log = (...a) => { if (!/^usage_(retention|sweep)/.test(String(a[0]))) realLog(...a); };
  const post = async (env, p, body, headers) => {
    const r = await w.fetch(new Request(HOST + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', Origin: HOST }, headers || {}), body: JSON.stringify(body) }), env, ctx);
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j };
  };
  const ME = 'uidFounder000000000000000001', OTHER = 'uidOther0000000000000000002';
  let n = 0;
  const ev = (name, props) => { n++; return { id: '6f1c0b8e-0000-4000-8000-' + n.toString(16).padStart(12, '0'), t: Date.now() - 1000, visit: 'v_abcd1234', name, props }; };
  const batch = (events) => ({ v: 1, tz: 'Asia/Dubai', device: 'd_k3j9x2m7q1aa', platform: 'browser', app_version: 'v368', events });
  try {
    // ---- The route, end to end ----
    docs.clear();
    docs.set('users/' + ME, { householdId: { stringValue: 'hhMine01' } });
    docs.set('households/hhMine01', { members: { mapValue: { fields: { [ME]: { stringValue: 'owner' } } } } });
    const db = fresh();
    const env = { USAGE_DB: db, USAGE_MODE: 'internal', INTERNAL_UIDS: ME, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
    const r1 = await post(env, '/api/usage', batch([ev('screen.viewed', { screen: 'home' }), ev('feature.used', { feature: 'feed', action: 'logged' })]), { Authorization: 'Bearer ' + idToken(ME) });
    ok('the route stores the founder\'s events in mode internal', r1.status === 200 && r1.body.accepted === 2, r1);
    ok('with the household proven from Firestore, not sent by the phone', db.raw.prepare('SELECT DISTINCT hid, role FROM usage_events').all().map((x) => x.hid + ':' + x.role).join() === 'hhMine01:owner');
    const r2 = await post(env, '/api/usage', batch([ev('screen.viewed', { screen: 'home' })]), { Authorization: 'Bearer not.a.token' });
    ok('a bad token is a 401', r2.status === 401, r2);
    const r3 = await post(env, '/api/usage', batch([ev('screen.viewed', { screen: 'home' })]), { Origin: 'https://evil.example' });
    ok('another origin is a 403', r3.status === 403, r3);
    const r4 = await post(Object.assign({}, env, { USAGE_MODE: undefined }), '/api/usage', batch([ev('screen.viewed', { screen: 'home' })]), { Authorization: 'Bearer ' + idToken(ME) });
    ok('with no mode set, the route answers off', r4.status === 200 && r4.body.mode === 'off', r4);
    const r5 = await post({ USAGE_MODE: 'internal', INTERNAL_UIDS: ME }, '/api/usage', batch([ev('screen.viewed', { screen: 'home' })]), { Authorization: 'Bearer ' + idToken(ME) });
    ok('with no database bound, the route answers off', r5.status === 200 && r5.body.mode === 'off', r5);
    const r6 = await post(env, '/api/usage', Object.assign(batch([ev('screen.viewed', { screen: 'home' })]), { uid: OTHER }), { Authorization: 'Bearer ' + idToken(ME) });
    ok('a body naming a uid is a 400', r6.status === 400, r6);
    // The route's log lines (S15): test/usage-route.test.js section 7 records every console method, with companions.

    // ---- The account purge ----
    const db2 = fresh();
    /* An hour before the pinned cron. Rows stamped at the epoch were 56 years old, so the cron's own
       retention run removed them and the household purge's usage_events check passed whatever it did. */
    const RECENT = CRON_NOW - 3600000;
    const seed = (uid, hid) => {
      db2.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,role,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-11-16', 5, 'UTC', ?, ?, 'owner', 'd_k3j9x2m7q1aa', 'v_abcd1234', 'browser', 'macOS', 'Safari', 'v368', 'screen.viewed', '{}')").run(uid, '6f1c0b8e-0000-4000-8000-' + (++n).toString(16).padStart(12, '0'), RECENT, RECENT, uid, hid);
      db2.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES ('2026-11-15', ?, ?, 'browser', 'visits', '', 1)").run(uid, hid);
      db2.raw.prepare("INSERT OR REPLACE INTO devices (device, uid, platform, os, browser, app_version, first_seen, last_seen) VALUES (?, ?, 'browser', 'macOS', 'Safari', 'v368', 1, 1)").run('d_' + uid.slice(3, 15).toLowerCase(), uid);
      db2.raw.prepare('INSERT OR REPLACE INTO membership (uid, hid, role, notice, checked_at) VALUES (?, ?, ?, ?, 1)').run(uid, hid, 'owner', '');
      db2.raw.prepare("INSERT INTO nudges (id, hid, uid, channel, template, body, sent_by, state, at) VALUES (?, ?, ?, 'note', 't', 'b', 'Saurav', 'sent', 1)").run('n_' + uid.slice(-8).toLowerCase(), hid, uid);
      db2.raw.prepare("INSERT INTO shared_entries (id, hid, shared_by, entry_id, entry, at, expires_at) VALUES (?, ?, ?, 'e1', '{}', 1, 2)").run('s_' + uid, hid, uid);
    };
    seed(ME, 'hhMine01'); seed(OTHER, 'hhOther01');
    /* The same few rows in any database (the erasure sections below). */
    const seed2 = (db, uid, hid) => {
      db.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,role,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-11-16', 5, 'UTC', ?, ?, 'owner', 'd_k3j9x2m7q1aa', 'v_abcd1234', 'browser', 'macOS', 'Safari', 'v368', 'screen.viewed', '{}')").run(uid, 'o-' + uid, RECENT, RECENT, uid, hid);
      db.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES ('2026-11-15', ?, ?, 'browser', 'visits', '', 1)").run(uid, hid);
      db.raw.prepare("INSERT OR REPLACE INTO membership (uid, hid, role, notice, checked_at) VALUES (?, ?, 'owner', '', 1)").run(uid, hid);
    };
    docs.set('feedback/fb1', { uid: { stringValue: ME }, text: { stringValue: 'hello' } });
    docs.set('feedback/fb2', { uid: { stringValue: OTHER }, text: { stringValue: 'hi' } });
    const games = makeD1();
    const env2 = { USAGE_DB: db2, GAMES_DB: games, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
    const pr = await post(env2, '/api/account/purge', { idToken: idToken(ME) });
    ok('the account purge answers ok', pr.status === 200 && pr.body.ok === true, pr);
    for (const [t, col] of [['usage_events', 'uid'], ['usage_daily', 'uid'], ['devices', 'uid'], ['membership', 'uid'], ['nudges', 'uid'], ['shared_entries', 'shared_by']]) {
      ok('the purge leaves no ' + t + ' row for the deleted person', count(db2, t, col + " = '" + ME + "'") === 0);
      ok('companion: and keeps the other person\'s ' + t + ' row', count(db2, t, col + " = '" + OTHER + "'") === 1);
    }
    ok("the purge deletes the person's feedback notes", !docs.has('feedback/fb1') && deletedDocs.includes('feedback/fb1'));
    ok("and only theirs", docs.has('feedback/fb2'));
    ok('in one documents:commit, never one request per note (W3)', commits.length === 1 && commits[0] === 1 && perNoteDeletes === 0, { commits, perNoteDeletes });

    // ---- The household purge, through the REAL cron: a due household's usage rows go with it ----
    const before = count(db2, 'usage_events', "hid = 'hhOther01'");
    docs.set('households/hhOther01', { deleteAfter: { integerValue: '1' } });
    dueHouseholds = ['hhOther01'];
    /* The cron runs on the pinned Monday, so the weekly orphan sweep stays out. Auth knows everyone here
       anyway, so even a sweep would erase nobody, and only the household purge can remove these rows. */
    authKnown = new Set([ME, OTHER]);
    await atCronClock(() => w.scheduled({}, { USAGE_DB: db2, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) }));
    dueHouseholds = [];
    ok('the cron deleted the due household document', deletedDocs.includes('households/hhOther01'), deletedDocs);
    ok('a deleted household loses its usage events and daily rows', before === 1 && count(db2, 'usage_events', "hid = 'hhOther01'") === 0 && count(db2, 'usage_daily', "hid = 'hhOther01'") === 0,
      { before, after: count(db2, 'usage_events', "hid = 'hhOther01'") });
    ok('and its nudges and shared entries', count(db2, 'nudges', "hid = 'hhOther01'") === 0 && count(db2, 'shared_entries', "hid = 'hhOther01'") === 0);
    /* Paired: the same cron's retention run alone must leave that household's event, or the check above
       could be passed by retention and prove nothing about the purge. */
    const db2b = fresh();
    db2b.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,role,device,visit,platform,os,browser,app_version,name,props) VALUES (?, 'keep-1', ?, ?, '2026-11-16', 5, 'UTC', ?, 'hhKept01', 'owner', 'd_k3j9x2m7q1aa', 'v_abcd1234', 'browser', 'macOS', 'Safari', 'v368', 'screen.viewed', '{}')").run(OTHER, RECENT, RECENT, OTHER);
    await atCronClock(() => w.scheduled({}, { USAGE_DB: db2b }));
    ok('companion: the cron\'s retention run alone keeps a household\'s recent usage event', count(db2b, 'usage_events', "hid = 'hhKept01'") === 1);

    // ---- Retention, pinned to a day and an hour ----
    const NOW = Date.UTC(2026, 10, 16, 6, 0, 0);
    const DAY = 86400000;
    const db3 = fresh();
    // Each row its own visit: a signed-in visit goes WHOLE once its oldest row expires (checked below).
    const put = (id, at, uid, props) => db3.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-01-01', 1, 'UTC', ?, 'd_k3j9x2m7q1aa', ?, 'browser', 'macOS', 'Safari', 'v368', 'screen.viewed', ?)").run(uid || 'anon_d_k3j9x2m7q1aa', id, at, at, uid, 'v_' + id, props || '{"screen":"home"}');
    put('old-linked', NOW - 91 * DAY, ME); put('new-linked', NOW - 89 * DAY, ME);
    put('old-anon', NOW - 31 * DAY, null); put('new-anon', NOW - 29 * DAY, null);
    put('old-kicks', NOW - 31 * DAY, ME, '{"screen":"kicks"}'); put('new-kicks', NOW - 29 * DAY, ME, '{"screen":"kicks"}');
    db3.raw.prepare("INSERT INTO usage_daily VALUES ('2025-10-01', '', '', 'browser', 'screen', 'kicks', 4), ('2025-11-01', '', '', 'browser', 'screen', 'kicks', 4)").run();
    await core.runRetention(db3, NOW);
    const ids = db3.raw.prepare('SELECT id FROM usage_events ORDER BY id').all().map((x) => x.id).join();
    ok('a 91-day-old linked row is gone and an 89-day-old one stays', !ids.includes('old-linked') && ids.includes('new-linked'), ids);
    ok('a 31-day-old anonymous row is gone and a 29-day-old one stays', !ids.includes('old-anon') && ids.includes('new-anon'), ids);
    ok('a 31-day-old pregnancy-only row is gone and a 29-day-old one stays', !ids.includes('old-kicks') && ids.includes('new-kicks'), ids);
    ok('aggregate days older than 13 months go, newer stay', db3.raw.prepare("SELECT local_day FROM usage_daily").all().map((x) => x.local_day).join() === '2025-11-01');

    // ---- The weekly orphan sweep: it puts each uid Auth no longer has on record, and the steps erase it ----
    const db4 = fresh();
    for (const u of [ME, OTHER]) db4.raw.prepare("INSERT INTO usage_daily VALUES ('2026-11-15', ?, 'h', 'browser', 'visits', '', 1)").run(u);
    authFails = true; authKnown = new Set([ME]);
    const lookup = async (uids) => { const r = await fetch(AUTH, { method: 'POST', body: JSON.stringify({ localId: uids }) }); if (!r.ok) throw new Error('lookup'); return { known: new Set(((await r.json()).users || []).map((x) => x.localId)) }; };
    const BUDGET = wmod.__usage ? { allowance: wmod.__usage.retentionDailyRows({}), dayMax: wmod.__usage.retentionDayMax({}) } : null;
    let threw = false;
    try { await core.orphanSweep(db4, lookup, CRON_NOW); } catch (e) { threw = true; }
    ok('when Auth fails to answer, the sweep stops and marks nobody', threw && count(db4, 'usage_daily') === 2 && count(db4, 'usage_meta', "key LIKE 'erase_uid:%'") === 0);
    authFails = false;
    await core.orphanSweep(db4, lookup, CRON_NOW);
    await core.erasePending(db4, CRON_NOW, BUDGET);
    ok('when Auth answers, a uid it no longer has is erased', count(db4, 'usage_daily', "uid = '" + OTHER + "'") === 0);
    ok('companion: and a uid it still has is kept', count(db4, 'usage_daily', "uid = '" + ME + "'") === 1);
    ok('its marker is held, not cleared, while an isolate may still remember her household (core.mjs ERASE_HOLD_MS)', count(db4, 'usage_meta', "key = 'erase_uid:" + OTHER + "'") === 1);
    await core.erasePending(db4, CRON_NOW + core.ERASE_HOLD_MS - MIN_MS, BUDGET);
    ok('companion: a minute before the hold ends, the cron leaves it', count(db4, 'usage_meta', "key = 'erase_uid:" + OTHER + "'") === 1);
    await core.erasePending(db4, CRON_NOW + core.ERASE_HOLD_MS, BUDGET);
    ok('and once the hold is over, the cron clears it', count(db4, 'usage_meta', "key LIKE 'erase_uid:%'") === 0);

    // ---- The cron runs retention once a day, through the real scheduled handler ----
    const db5 = fresh();
    await atCronClock(() => w.scheduled({}, { USAGE_DB: db5 }));
    const mark = db5.raw.prepare("SELECT value FROM usage_meta WHERE key = 'retention_day'").get();
    ok('the cron records its own day\'s retention run (pinned: ' + CRON_DAY + ', 06:00 UTC)', !!mark && mark.value === CRON_DAY, mark);

    /* ---- Retention keeps a signed-in visit whole (F5, the retention half of PRIV-2) ----
       The phone sends a visit in several batches, so one visit's rows carry different arrival times. A dose
       visit whose dose batch is past 90 days and whose later batches are not must go together: a surviving
       tail would show its own minutes with no dose row left to mark the visit hour-only. */
    const CUT = CRON_NOW - 90 * DAY_MS;
    const db6 = fresh();
    const row6 = (id, at, uid, visit, name, props) => db6.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-08-18', 3, 'Asia/Dubai', ?, 'hhMine01', 'd_k3j9x2m7q1aa', ?, 'ios_app', 'iOS 18.2', 'Safari', 'v369', ?, ?)").run(uid, id, at, at, uid, visit, name, props);
    row6('dose-start', CUT - MIN_MS, ME, 'v_dose0001', 'visit.started', '{"opened_from":"icon","start":"cold"}');
    row6('dose-dose', CUT - MIN_MS + 5000, ME, 'v_dose0001', 'feature.used', '{"action":"logged","feature":"medicine"}');
    row6('dose-feed', CUT + 20 * MIN_MS, ME, 'v_dose0001', 'feature.used', '{"action":"logged","feature":"feed"}');
    row6('dose-end', CUT + 25 * MIN_MS, ME, 'v_dose0001', 'visit.ended', '{"reason":"hidden","seconds":1500}');
    row6('young-start', CUT + MIN_MS, ME, 'v_young001', 'visit.started', '{"opened_from":"icon","start":"cold"}');
    row6('young-end', CUT + 9 * MIN_MS, ME, 'v_young001', 'visit.ended', '{"reason":"hidden","seconds":480}');
    // Another person whose visit id happens to be the same string: hers is young, so it stays.
    row6('other-start', CUT + 30 * MIN_MS, OTHER, 'v_dose0001', 'visit.started', '{"opened_from":"icon","start":"cold"}');
    await core.runRetention(db6, CRON_NOW);
    const left6 = db6.raw.prepare('SELECT id FROM usage_events ORDER BY id').all().map((x) => x.id).join();
    ok('a dose visit split by the 90-day cutoff goes whole: no later batch of it survives', !/dose-/.test(left6), left6);
    ok('and no row older than 90 days remains (S25)', count(db6, 'usage_events', 'at < ' + CUT) === 0);
    ok('companion: a visit wholly inside 90 days stays whole', /young-start/.test(left6) && /young-end/.test(left6), left6);
    ok('companion: another person\'s visit under the same visit id stays', /other-start/.test(left6), left6);

    /* ---- Retention: anonymous phones' device rows, and the day ceiling's counters (PRIV-6) ---- */
    const db7 = fresh();
    const dev7 = (device, uid, last) => db7.raw.prepare("INSERT INTO devices (device, uid, platform, os, browser, app_version, first_seen, last_seen) VALUES (?, ?, 'browser', 'iOS 18.2', 'Safari', 'v369', ?, ?)").run(device, uid, last, last);
    dev7('d_anonold00001', null, CRON_NOW - 31 * DAY_MS); dev7('d_anonnew00001', null, CRON_NOW - 29 * DAY_MS); dev7('d_linkedold001', ME, CRON_NOW - 400 * DAY_MS);
    for (const k of ['events_2026-08-01', core.ceilingKey('membership', '2026-08-01'), 'events_2026-11-15', core.ceilingKey('membership', '2026-11-15'), 'sweep_day']) db7.raw.prepare('INSERT INTO usage_meta (key, value, at) VALUES (?, ?, 1)').run(k, '5');
    await core.runRetention(db7, CRON_NOW);
    const devs7 = db7.raw.prepare('SELECT device FROM devices ORDER BY device').all().map((x) => x.device).join();
    ok('a never-signed-in phone\'s device row goes 30 days after it was last seen', !devs7.includes('d_anonold00001'), devs7);
    ok('companion: one seen 29 days ago stays', devs7.includes('d_anonnew00001'), devs7);
    ok('companion: a signed-in device row stays until its account goes', devs7.includes('d_linkedold001'), devs7);
    const keys7 = db7.raw.prepare('SELECT key FROM usage_meta ORDER BY key').all().map((x) => x.key).join();
    ok('a day ceiling counter older than 90 days goes, the membership ceiling\'s too; a recent one and the cron markers stay', keys7 === 'events_2026-11-15,events_2026-11-15_membership,sweep_day', keys7);

    /* ---- Retention drains more than one tick can, through the REAL cron (W4, PRIV-1) ----
       25,000 expired rows: one tick runs 10 statements of 2,000, so it cannot finish. The day is recorded
       as done only once every class is drained; until then each tick carries on. Pinned: Monday 16 November
       2026 at 06:00, 06:15 and 06:30 UTC. */
    const db8 = fresh();
    const ins8 = db8.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-08-17', 6, 'UTC', ?, 'd_k3j9x2m7q1aa', ?, 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{\"screen\":\"home\"}')");
    db8.raw.exec('BEGIN'); for (let i = 0; i < 25000; i++) ins8.run(ME, 'bulk' + i, CUT - DAY_MS + i, CUT - DAY_MS + i, ME, 'v_b' + i); db8.raw.exec('COMMIT');
    const env8 = { USAGE_DB: db8, USAGE_DAILY_CAP: '20000' };
    const day8 = () => (db8.raw.prepare("SELECT value FROM usage_meta WHERE key = 'retention_day'").get() || {}).value || null;
    await atClock(CRON_NOW, () => w.scheduled({}, env8));
    const after1 = count(db8, 'usage_events', 'at < ' + CUT);
    ok('the first tick deletes what its bound allows and does not mark the day done', after1 > 0 && after1 < 25000 && day8() === null, { after1, mark: day8() });
    await atClock(CRON_NOW + 15 * MIN_MS, () => w.scheduled({}, env8));
    ok('the next tick the same day carries on until nothing expired is left (S25)', count(db8, 'usage_events', 'at < ' + CUT) === 0, count(db8, 'usage_events', 'at < ' + CUT));
    ok('and only then records the day (pinned: ' + CRON_DAY + ')', day8() === CRON_DAY, day8());
    ins8.run(ME, 'late1', CUT - 1, CUT - 1, ME, 'v_late0001');
    await atClock(CRON_NOW + 30 * MIN_MS, () => w.scheduled({}, env8));
    ok('companion: once the day is recorded, later ticks that day leave retention alone', count(db8, 'usage_events', "id = 'late1'") === 1);

    /* ---- Retention's daily delete allowance: a backlog drains over days, not in one (W4, SE-V2) ----
       Cap 1,000 gives an allowance of 2,250 rows a UTC day: retention's own part, 2,100, and the erasures'
       floor, 150, which retention takes as well at the day's last tick (23:45 UTC) when no erasure has. 5,000
       expired rows: 2,100 at 06:00, nothing at 06:15, 150 at 23:45; the same the next day; then 500. */
    const db8b = fresh();
    const ins8b = db8b.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-08-17', 6, 'UTC', NULL, 'd_k3j9x2m7q1aa', ?, 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{\"screen\":\"signin\"}')");
    db8b.raw.exec('BEGIN'); for (let i = 0; i < 5000; i++) ins8b.run('anon_d_k3j9x2m7q1aa', 'anon' + i, CUT - i, CUT - i, 'v_a' + i); db8b.raw.exec('COMMIT');
    const env8b = { USAGE_DB: db8b, USAGE_DAILY_CAP: '1000' };
    const gone8b = [];
    let was = count(db8b, 'usage_events');
    for (const [d, m] of [[0, 0], [0, 15], [0, 1065], [1, 0], [1, 15], [1, 1065], [2, 0]]) {   // 16, 17 and 18 November 2026: 06:00, 06:15 and 23:45 UTC
      await atClock(CRON_NOW + d * DAY_MS + m * MIN_MS, () => w.scheduled({}, env8b));
      const now8 = count(db8b, 'usage_events'); gone8b.push(was - now8); was = now8;
    }
    ok('a backlog drains at the daily allowance: retention\'s 2,100 at the first tick, nothing at the next, the erasures\' unused 150 at the day\'s last', gone8b.join() === '2100,0,150,2100,0,150,500', gone8b);
    ok('and the day is recorded once the backlog is gone (pinned: 18 November 2026)', (db8b.raw.prepare("SELECT value FROM usage_meta WHERE key = 'retention_day'").get() || {}).value === '2026-11-18');

    /* ---- After an outage, person-linked rows take the allowance first (ERA-SK-2) ----
       Cap 1,000 (allowance 2,250, of which retention's own part is 2,100). A backlog of 4,000 anonymous rows
       past 30 days and 500 signed-in rows past 90 days, in visits of five. One day cannot take both: the
       signed-in rows must go on that day, and the anonymous ones wait. Pinned: Monday 16 November 2026 06:00
       and 23:45 UTC, then Tuesday 06:00 and 23:45 UTC. */
    {
      const dbo = fresh();
      const inso = dbo.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-08-17', 6, 'UTC', ?, 'd_k3j9x2m7q1aa', ?, 'browser', 'macOS', 'Safari', 'v369', ?, ?)");
      const ACUT = CRON_NOW - 30 * DAY_MS;
      dbo.raw.exec('BEGIN');
      for (let i = 0; i < 4000; i++) inso.run('anon_d_k3j9x2m7q1aa', 'oa' + i, ACUT - DAY_MS - i * 1000, ACUT - DAY_MS - i * 1000, null, 'v_oa' + Math.floor(i / 5), 'screen.viewed', '{"screen":"signin"}');
      for (let i = 0; i < 500; i++) inso.run(ME, 'ol' + i, CUT - DAY_MS + i * 1000, CUT - DAY_MS + i * 1000, ME, 'v_ol' + Math.floor(i / 5), i % 5 ? 'screen.viewed' : 'visit.started', i % 5 ? '{"screen":"home"}' : '{"opened_from":"icon","start":"cold"}');
      dbo.raw.exec('COMMIT');
      const envo = { USAGE_DB: dbo, USAGE_DAILY_CAP: '1000' };
      await atClock(CRON_NOW, () => w.scheduled({}, envo));
      const linkedOld = count(dbo, 'usage_events', 'uid IS NOT NULL AND at < ' + CUT), anonOld = count(dbo, 'usage_events', 'uid IS NULL AND at < ' + ACUT);
      ok('after an outage, person-linked rows go first: no signed-in row past 90 days after the first day\'s run', linkedOld === 0, { linkedOld, anonOld });
      ok('companion: the anonymous backlog waits, within retention\'s part of the day (2,100 rows in all)', anonOld === 4000 - (2100 - 500), { anonOld });
      for (const t of [CRON_NOW + 1065 * MIN_MS, CRON_NOW + DAY_MS, CRON_NOW + DAY_MS + 1065 * MIN_MS]) await atClock(t, () => w.scheduled({}, envo));
      ok('and goes the next day (pinned: Tuesday 17 November 2026, by 23:45 UTC)', count(dbo, 'usage_events', 'uid IS NULL AND at < ' + (ACUT + DAY_MS)) === 0, count(dbo, 'usage_events', 'uid IS NULL AND at < ' + (ACUT + DAY_MS)));
    }

    /* ---- One visit too big for a statement: the allowance holds, and its head goes first (F5) ----
       A client can reuse one visit id for days, so one "visit" can hold thousands of rows. Deleting it whole
       in one statement would pass the day's allowance by all of them. Cap 1,000 (allowance 2,250): one visit
       of 6,001 rows, 3,001 of them past 90 days (a dose the oldest, and its visit.started row a day past the
       cutoff, younger than the rest), and 3,000 young ones from three days after it. Oldest-first alone would
       cut the visit after its dose with its head standing; head first, what is left of it reads hour-only.
       Pinned: Monday 16 November 2026 06:00 UTC, then Tuesday 06:00 UTC. */
    {
      const dbg = fresh();
      const insg = dbg.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-08-17', 6, 'UTC', ?, 'hhMine01', 'd_k3j9x2m7q1aa', 'v_giant001', 'ios_app', 'iOS 18.2', 'Safari', 'v369', ?, ?)");
      dbg.raw.exec('BEGIN');
      insg.run(ME, 'g-dose', CUT - 3 * DAY_MS, CUT - 3 * DAY_MS, ME, 'feature.used', '{"action":"logged","feature":"medicine"}');
      for (let i = 0; i < 2999; i++) insg.run(ME, 'g-old' + i, CUT - 2 * DAY_MS + i, CUT - 2 * DAY_MS + i, ME, 'screen.viewed', '{"screen":"home"}');
      insg.run(ME, 'g-head', CUT - DAY_MS, CUT - DAY_MS, ME, 'visit.started', '{"opened_from":"icon","start":"cold"}');
      for (let i = 0; i < 3000; i++) insg.run(ME, 'g-young' + i, CUT + 3 * DAY_MS + 1 + i, CUT + 3 * DAY_MS + 1 + i, ME, 'screen.viewed', '{"screen":"home"}');
      dbg.raw.exec('COMMIT');
      const envg = { USAGE_DB: dbg, USAGE_DAILY_CAP: '1000' };
      const has = (id) => count(dbg, 'usage_events', "id = '" + id + "'") === 1;
      const before = count(dbg, 'usage_events');
      await atClock(CRON_NOW, () => w.scheduled({}, envg));
      const gone1 = before - count(dbg, 'usage_events');
      ok('retention never deletes more than the day\'s allowance, even inside one visit (' + gone1 + ' of 2,250)', gone1 <= 2250 && gone1 > 0, gone1);
      ok('the visit loses its head before any other row, so what is left reads hour-only (F5)', !has('g-head'), { head: has('g-head'), dose: has('g-dose') });
      const mid = count(dbg, 'usage_events');
      await atClock(CRON_NOW + DAY_MS, () => w.scheduled({}, envg));
      ok('the next day\'s run takes the rest of what expired, within its allowance (S25; pinned 17 November 2026)', count(dbg, 'usage_events', 'at < ' + (CUT + DAY_MS)) === 0 && mid - count(dbg, 'usage_events') <= 2250,
        { left: count(dbg, 'usage_events', 'at < ' + (CUT + DAY_MS)), gone: mid - count(dbg, 'usage_events') });
      ok('companion: the rows of the visit that have not expired stay, headless, until they expire themselves', count(dbg, 'usage_events') === 3000 && count(dbg, 'usage_events', "name = 'visit.started'") === 0, count(dbg, 'usage_events'));
    }

    /* ---- One visit id with thousands of young visit.started rows (RE-SK-1) ----
       A client reuses one visit id for 90 days and sends 8,000 visit.started rows into it now, plus one row
       of it past 90 days, so retention picks the visit. Other families have 400 two-row visits past 90 days
       and 500 pregnancy-only rows past 30. Cap 1,500 (allowance 3,375). Heads first across the whole pick
       spent the day on the young heads, and the other families' rows waited. Every expired row must go on
       the first day, inside the allowance. Pinned: Monday 16 November 2026 06:00 UTC. */
    {
      const dbh = fresh();
      const insh = dbh.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-08-17', 6, 'UTC', ?, 'd_k3j9x2m7q1aa', ?, 'browser', 'macOS', 'Safari', 'v369', ?, ?)");
      const HEAD = '{"opened_from":"icon","start":"cold"}';
      const JCUT = CRON_NOW - 30 * DAY_MS;
      dbh.raw.exec('BEGIN');
      insh.run(OTHER, 'h-old', CUT - 5 * DAY_MS, CUT - 5 * DAY_MS, OTHER, 'v_reused01', 'feature.used', '{"action":"logged","feature":"feed"}');
      for (let i = 0; i < 8000; i++) insh.run(OTHER, 'h-head' + i, CRON_NOW - 3 * DAY_MS + i, CRON_NOW - 3 * DAY_MS + i, OTHER, 'v_reused01', 'visit.started', HEAD);
      for (let i = 0; i < 400; i++) {
        const at = CUT - 2 * DAY_MS + i * 1000;
        insh.run(ME, 'f-head' + i, at, at, ME, 'v_fam' + i, 'visit.started', HEAD);
        insh.run(ME, 'f-feed' + i, at + 500, at + 500, ME, 'v_fam' + i, 'feature.used', '{"action":"logged","feature":"feed"}');
      }
      for (let i = 0; i < 500; i++) insh.run(ME, 'j' + i, JCUT - DAY_MS + i, JCUT - DAY_MS + i, ME, 'v_j' + i, 'screen.viewed', '{"screen":"kicks"}');
      dbh.raw.exec('COMMIT');
      const before = count(dbh, 'usage_events');
      await atClock(CRON_NOW, () => w.scheduled({}, { USAGE_DB: dbh, USAGE_DAILY_CAP: '1500' }));
      const others = count(dbh, 'usage_events', "uid = '" + ME + "' AND at < " + CUT), journey = count(dbh, 'usage_events', "props LIKE '%kicks%' AND at < " + JCUT);
      ok('one visit id holding 8,000 young visit.started rows does not use up the day: every other family\'s row past 90 days goes on the first day (RE-SK-1)', others === 0, { others, journey });
      ok('and every pregnancy-only row past 30 days (RE-SK-1)', journey === 0, { others, journey });
      ok('and the reused visit\'s own expired row', count(dbh, 'usage_events', "id = 'h-old'") === 0);
      ok('companion: the young visit.started rows were there to take the allowance, and only what expired went (' + (before - count(dbh, 'usage_events')) + ' rows)',
        count(dbh, 'usage_events', "name = 'visit.started' AND visit = 'v_reused01'") === 8000 && before - count(dbh, 'usage_events') === 1301, before - count(dbh, 'usage_events'));
    }

    /* ---- The household purge erases its usage rows at once, whole visits, and leaves no marker ---- */
    const pending = (db) => db.raw.prepare("SELECT COUNT(*) AS c FROM usage_meta WHERE key >= 'erase_hid:' AND key < 'erase_hid;'").get().c;
    const CARER = 'uidCarer000000000000000004';
    const seedHh = (db, hid) => {
      const r = (id, h, visit) => db.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,role,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-11-16', 5, 'UTC', ?, ?, 'caregiver', 'd_carer0000001', ?, 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{\"screen\":\"home\"}')").run(CARER, id + hid, RECENT, RECENT, CARER, h, visit);
      // A visit that moved between families part-way: two rows carry the purged household, one the new one.
      r('m1', hid, 'v_move0001'); r('m2', hid, 'v_move0001'); r('m3', 'hhNew0001', 'v_move0001');
      r('s1', 'hhNew0001', 'v_stay0001');
      db.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES ('2026-11-15', ?, ?, 'browser', 'visits', '', 2)").run(CARER, hid);
      db.raw.prepare("INSERT INTO nudges (id, hid, uid, channel, template, body, sent_by, state, at) VALUES (?, ?, ?, 'note', 't', 'b', 'Saurav', 'sent', 1)").run('n_' + hid, hid, CARER);
    };
    const hhLeft = (db, hid) => count(db, 'usage_events', "hid = '" + hid + "'") + count(db, 'usage_daily', "hid = '" + hid + "'") + count(db, 'nudges', "hid = '" + hid + "'");
    const purgeOnly = wmod.__purge && wmod.__purge.purgeDeletedHouseholds;
    const db9a = fresh();
    seedHh(db9a, 'hhGone01');
    docs.set('households/hhGone01', { deleteAfter: { integerValue: '1' } }); dueHouseholds = ['hhGone01'];
    await atCronClock(() => purgeOnly({ USAGE_DB: db9a, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) }));
    dueHouseholds = [];
    ok('the household purge alone (no later cron step) erases the household\'s usage rows', !docs.has('households/hhGone01') && hhLeft(db9a, 'hhGone01') === 0, hhLeft(db9a, 'hhGone01'));
    ok('and every row of a visit that carried it, so no visit is left half there', count(db9a, 'usage_events', "visit = 'v_move0001'") === 0, count(db9a, 'usage_events', "visit = 'v_move0001'"));
    ok('companion: the person\'s visit in her new family stays', count(db9a, 'usage_events', "visit = 'v_stay0001'") === 1);
    ok('and leaves no pending erasure behind', pending(db9a) === 0, pending(db9a));

    /* ---- A household erasure that fails after the document is gone is retried (W5) ----
       The document goes, then D1 refuses the erasure twice (the purge's own try, and the retry later in
       the same cron run). The household is never found again, so only the pending marker can bring it
       back: the next tick must finish it. Pinned: Monday 16 November 2026, 06:00 and 06:15 UTC. */
    let failSql = null, failLeft = 0, failKey = null;
    const hooked = () => { const d = makeD1({ hooks: { before(sql, args) {
      if (failLeft > 0 && failSql && failSql.test(sql) && (!failKey || String(args && args[0]).startsWith(failKey))) { failLeft--; throw new Error('D1_ERROR: staged'); }
    } } }); d.raw.exec(schema); return d; };
    const db9 = hooked();
    seedHh(db9, 'hhGone02');
    docs.set('households/hhGone02', { deleteAfter: { integerValue: '1' } }); dueHouseholds = ['hhGone02'];
    failSql = /^DELETE FROM usage_events WHERE .*hid/; failLeft = 2; failKey = null;
    const errAt9 = errs.length;
    const env9 = { USAGE_DB: db9, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
    await atCronClock(() => w.scheduled({}, env9));
    ok('staged: the document went and the erasure failed', !docs.has('households/hhGone02') && hhLeft(db9, 'hhGone02') > 0 && failLeft === 0, { left: hhLeft(db9, 'hhGone02'), failLeft });
    ok('the failure left a pending erasure on record', pending(db9) === 1, pending(db9));
    ok('and was logged by code', errs.slice(errAt9).some((e) => /purge_usage_hid_fail/.test(e)), errs.slice(errAt9));
    await atClock(CRON_NOW + 15 * MIN_MS, () => w.scheduled({}, env9));
    dueHouseholds = [];
    ok('the next tick finishes it: no row of the deleted household is left', hhLeft(db9, 'hhGone02') === 0 && count(db9, 'usage_events', "visit = 'v_move0001'") === 0, hhLeft(db9, 'hhGone02'));
    ok('and clears the marker with the rows', pending(db9) === 0, pending(db9));

    /* ---- If even the marker cannot be written, the family's data still goes on time (ERA-SK-1) ----
       cubby-usage refuses every statement for the whole of one tick, as at the account's daily limit. The
       household's own data must not wait behind analytics: the document is cut down to a shell that holds
       only what brings the purge back (deleteAfter, deletionRequestedBy, ownerId, and purgeShell), with its
       deleteAfter an hour on, so a stuck shell is out of the purge query's way until then (RE-SK-4). An hour
       and a quarter later, D1 answering, the purge finishes the usage rows and the shell. Pinned: Monday 16
       November 2026, 06:00, 06:15 and 07:15 UTC. The real Firestore's side of the shell write is
       test/feedback-purge-emulator.test.js. */
    const db9b = hooked();
    seedHh(db9b, 'hhGone03');
    const FAMILY = { app: { mapValue: { fields: { babies: { stringValue: 'Maya, born 2 May' }, medicines: { stringValue: 'Calpol 2.5ml' } } } },
      memberInfo: { mapValue: { fields: { uidGone: { mapValue: { fields: { name: { stringValue: 'Sam' } } } } } } }, name: { stringValue: 'The Ahmeds' } };
    docs.set('households/hhGone03', Object.assign({ deleteAfter: { integerValue: '1' }, deletionRequestedBy: { stringValue: 'uidGone' }, ownerId: { stringValue: 'uidGone' },
      members: { mapValue: {} } }, FAMILY));
    dueHouseholds = ['hhGone03'];
    failSql = /./; failLeft = 1e9; failKey = null;
    const errAt9b = errs.length, shellsAt9b = shellWrites.length, bwAt9b = batchWrites.length;
    const env9b = { USAGE_DB: db9b, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
    await atCronClock(() => w.scheduled({}, env9b));
    const shell9b = docs.get('households/hhGone03');
    ok('staged: D1 refused every statement, the marker included, and no household row was erased yet', failLeft < 1e9 && pending(db9b) === 0 && hhLeft(db9b, 'hhGone03') > 0
      && errs.slice(errAt9b).some((e) => /usage_retention_fail/.test(e)), { tries: 1e9 - failLeft, left: hhLeft(db9b, 'hhGone03') });
    ok('when the marker cannot be written, the family\'s data is gone at once: no app blob, no names, no members', !!shell9b && Object.keys(FAMILY).every((k) => !(k in shell9b)) && !('members' in shell9b),
      shell9b && Object.keys(shell9b));
    ok('and only a shell is left: deleteAfter, deletionRequestedBy, ownerId and purgeShell, exactly', !!shell9b && Object.keys(shell9b).sort().join() === 'deleteAfter,deletionRequestedBy,ownerId,purgeShell'
      && shell9b.deletionRequestedBy.stringValue === 'uidGone' && !!shell9b.purgeShell && shell9b.purgeShell.booleanValue === true, shell9b);
    ok('its deleteAfter moves an hour on, so the stuck shell waits out of the purge query\'s way (RE-SK-4)', !!(shell9b && shell9b.deleteAfter) && Number(shell9b.deleteAfter.integerValue) === CRON_NOW + 3600000, shell9b && shell9b.deleteAfter);
    ok('written once, as one whole-document batchWrite with a precondition', shellWrites.length - shellsAt9b === 1 && batchWrites.length - bwAt9b === 1, { shells: shellWrites.slice(shellsAt9b), batchWrites: batchWrites.slice(bwAt9b) });
    ok('and that is logged by code', errs.slice(errAt9b).some((e) => /purge_usage_mark_fail/.test(e)) && !errs.slice(errAt9b).some((e) => /purge_shell_fail/.test(e)), errs.slice(errAt9b));
    failSql = null; failKey = null; failLeft = 0;
    await atClock(CRON_NOW + 15 * MIN_MS, () => w.scheduled({}, env9b));
    ok('companion: a quarter of an hour later, D1 answering, the shell is not due yet and stays', docs.has('households/hhGone03') && hhLeft(db9b, 'hhGone03') > 0, { doc: docs.has('households/hhGone03') });
    await atClock(CRON_NOW + 75 * MIN_MS, () => w.scheduled({}, env9b));
    dueHouseholds = [];
    ok('an hour after it was written, D1 answering, the purge deletes the shell and the usage rows, and clears the marker', !docs.has('households/hhGone03') && hhLeft(db9b, 'hhGone03') === 0 && pending(db9b) === 0
      && count(db9b, 'usage_events', "visit = 'v_move0001'") === 0, { doc: docs.has('households/hhGone03'), left: hhLeft(db9b, 'hhGone03'), pending: pending(db9b) });

    /* ---- A family's shell is written before a heavy family after it can use up the tick (SK2-1) ----
       D1 refuses every statement. Two families are due: a light one first, then one whose children use up the
       tick's 50 subrequests (staged: from its first listing on, every fetch throws, as Workers do). The light
       family's shell must be written as soon as its marker fails, not with a write at the end of the tick
       that the heavy family has made impossible. test/feedback-purge-emulator.test.js proves the same on a
       real Firestore with a counted budget. Pinned: Monday 16 November 2026, 08:00 UTC. */
    {
      const db9c = hooked();
      seedHh(db9c, 'hhLight9');   // D1 refuses everything here, so the heavy family needs no usage rows
      for (const [h, due] of [['hhLight9', '1'], ['hhHeavy9', '2']]) docs.set('households/' + h, Object.assign({ deleteAfter: { integerValue: due }, deletionRequestedBy: { stringValue: 'uidGone' }, ownerId: { stringValue: 'uidGone' }, members: { mapValue: {} } }, FAMILY));
      dueHouseholds = ['hhLight9', 'hhHeavy9'];
      failSql = /./; failLeft = 1e9; failKey = null;
      budgetGoneAt = /\/households\/hhHeavy9\//;
      await atClock(Date.UTC(2026, 10, 16, 8, 0, 0), () => w.scheduled({}, { USAGE_DB: db9c, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) }));
      const gone = budgetGone;
      budgetGoneAt = null; budgetGone = false; failSql = null; failLeft = 0; dueHouseholds = [];
      const light = docs.get('households/hhLight9'), heavy = docs.get('households/hhHeavy9');
      ok('a light family due first is cut down to its shell though the heavy family after it uses up the tick (SK2-1)', gone && !!light
        && Object.keys(light).sort().join() === 'deleteAfter,deletionRequestedBy,ownerId,purgeShell', { gone, keys: light && Object.keys(light) });
      ok('companion: the heavy family, its children not all gone, keeps its document as it was', !!heavy && 'app' in heavy && 'members' in heavy && !('purgeShell' in heavy), heavy && Object.keys(heavy));
    }

    /* ---- An erasure bigger than one step, through the real purge route and the real cron (ERASE-CHUNK) ----
       One person with 3,708 usage rows: a membership row, 2 devices, 3 nudges, 2 shared entries, 1,200 daily
       totals and 2,500 events, more than one step (core.mjs ERASE_CHUNK, 1,000) and more than one UTC day's
       delete allowance at the shipped cap (3,375). Another person's rows stay throughout. The purge runs
       Tuesday 17 November 2026 at 22:00 UTC, on a database where retention has not run that day, then the
       cron every quarter of an hour until Wednesday 18 November 00:30 UTC. */
    const HEAVY = 'uidHeavy0000000000000000005';
    const seedHeavy = (db, uid, hid, nEvents, nDaily) => {
      const T = Date.UTC(2026, 10, 17, 12, 0, 0);
      db.raw.exec('BEGIN');
      const ev = db.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,role,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-11-17', 12, 'UTC', ?, ?, 'owner', 'd_heavy0000001', ?, 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{\"screen\":\"home\"}')");
      for (let i = 0; i < (nEvents || 2500); i++) ev.run(uid, 'hv' + i, T - i * 1000, T - i * 1000, uid, hid, 'v_h' + Math.floor(i / 5));
      const daily = db.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES (?, ?, ?, 'browser', 'screen', ?, 1)");
      for (let i = 0; i < (nDaily || 1200); i++) daily.run(new Date(T - Math.floor(i / 30) * DAY_MS).toISOString().slice(0, 10), uid, hid, 'k' + (i % 30));
      for (const d of ['d_heavy0000001', 'd_heavy0000002']) db.raw.prepare("INSERT INTO devices (device, uid, platform, os, browser, app_version, first_seen, last_seen) VALUES (?, ?, 'browser', 'macOS', 'Safari', 'v369', 1, 1)").run(d, uid);
      db.raw.prepare("INSERT INTO membership (uid, hid, role, notice, checked_at) VALUES (?, ?, 'owner', '', ?)").run(uid, hid, T);
      for (let i = 0; i < 3; i++) db.raw.prepare("INSERT INTO nudges (id, hid, uid, channel, template, body, sent_by, state, at) VALUES (?, ?, ?, 'note', 't', 'b', 'Saurav', 'sent', 1)").run('n_' + uid + i, hid, uid);
      for (let i = 0; i < 2; i++) db.raw.prepare("INSERT INTO shared_entries (id, hid, shared_by, entry_id, entry, at, expires_at) VALUES (?, ?, ?, 'e1', '{}', 1, 2)").run('s_' + uid + i, hid, uid);
      db.raw.exec('COMMIT');
    };
    const rowsOfUid = (db, uid) => ['usage_events', 'usage_daily', 'devices', 'membership', 'nudges'].reduce((a, t) => a + count(db, t, "uid = '" + uid + "'"), 0) + count(db, 'shared_entries', "shared_by = '" + uid + "'");
    const markers = (db, prefix) => count(db, 'usage_meta', "key >= '" + prefix + "' AND key < '" + prefix.slice(0, -1) + ";'");
    /* Every D1 batch's rows, less the marker's own (a step is one batch): the size of each step as it ran. */
    const recordSteps = (db) => {
      const sizes = [], real = db.batch.bind(db);
      db.batch = async (list) => {
        const r = await real(list);
        const n = list.reduce((a, st, i) => a + (/usage_meta/.test(st._sql) ? 0 : ((r[i] && r[i].meta && r[i].meta.changes) || 0)), 0);
        if (n) sizes.push(n);
        return r;
      };
      return sizes;
    };
    const meta = (db, k) => (db.raw.prepare('SELECT value FROM usage_meta WHERE key = ?').get(k) || {}).value;
    {
      const dbc = hooked();
      seedHeavy(dbc, HEAVY, 'hhHeavy01'); seed2(dbc, OTHER, 'hhOther02');
      const stepSizes = recordSteps(dbc);
      const total = rowsOfUid(dbc, HEAVY), otherBefore = rowsOfUid(dbc, OTHER);
      const envc = { USAGE_DB: dbc, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
      const allowance = wmod.__usage.retentionDailyRows(envc), dayMax = wmod.__usage.retentionDayMax(envc);
      const T0 = Date.UTC(2026, 10, 17, 22, 0, 0);
      const steps = [], byDay = {};
      const took = (t, before) => { const g = before - rowsOfUid(dbc, HEAVY); steps.push(g); const d = new Date(t).toISOString().slice(0, 10); byDay[d] = (byDay[d] || 0) + g; };
      let before = rowsOfUid(dbc, HEAVY);
      const pr = await atClock(T0, () => post(envc, '/api/account/purge', { idToken: idToken(HEAVY) }));
      took(T0, before);
      ok('(staged: ' + total + ' rows, more than one step and more than a day\'s allowance of ' + allowance + ')', total === 3708 && total > core.ERASE_CHUNK && total > allowance, { total, allowance });
      ok('the purge answers ok when the erasure is on record but not finished', pr.status === 200 && pr.body && pr.body.ok === true, pr);
      ok('and puts it on record: a pending marker for her', markers(dbc, core.PENDING_UID) === 1 && count(dbc, 'usage_meta', "key = 'erase_uid:" + HEAVY + "'") === 1, markers(dbc, core.PENDING_UID));
      ok('her membership row goes in the first step, so nothing links her to a household from then on', count(dbc, 'membership', "uid = '" + HEAVY + "'") === 0);
      ok('before retention has finished the day, the first step takes only what lies beyond the day\'s expiry (' + steps[0] + ' rows, at most ' + (allowance - dayMax) + ')', steps[0] > 0 && steps[0] <= allowance - dayMax - 2, steps[0]);
      for (let k = 1; k <= 10; k++) {
        const t = T0 + k * 15 * MIN_MS;
        before = rowsOfUid(dbc, HEAVY);
        await atClock(t, () => w.scheduled({}, envc));
        took(t, before);
      }
      ok('every step deletes at most ' + core.ERASE_CHUNK + ' rows (' + stepSizes.join(', ') + ')', stepSizes.length >= 4 && stepSizes.every((g) => g <= core.ERASE_CHUNK) && stepSizes.reduce((a, b) => a + b, 0) === total, stepSizes);
      ok('no UTC day deletes more than the shared delete allowance, retention included (17 Nov: ' + byDay['2026-11-17'] + ' + retention ' + core.retentionSpent(meta(dbc, 'retention_rows'), '2026-11-17') + ')',
        Object.values(byDay).every((g) => g <= allowance) && (Number(meta(dbc, core.ceilingKey('erase', '2026-11-17'))) || 0) <= allowance, { byDay, counter: meta(dbc, core.ceilingKey('erase', '2026-11-17')) });
      ok('companion: the erasure was held back on 17 November and finished after midnight (the allowance bound)', byDay['2026-11-17'] < total && byDay['2026-11-18'] > 0, byDay);
      ok('across the ticks every row of hers goes, in every usage table (pinned: 18 November 2026, 00:30 UTC)', rowsOfUid(dbc, HEAVY) === 0, rowsOfUid(dbc, HEAVY));
      ok('and her marker is held after the last of them, so nothing links her yet', markers(dbc, core.PENDING_UID) === 1, markers(dbc, core.PENDING_UID));
      await atClock(T0 + core.ERASE_HOLD_MS, () => w.scheduled({}, envc));
      ok('then clears on the first tick after the hold (pinned: 18 November 2026, 04:00 UTC)', markers(dbc, core.PENDING_UID) === 0, markers(dbc, core.PENDING_UID));
      ok('companion: the other person\'s rows stay', rowsOfUid(dbc, OTHER) === otherBefore, { now: rowsOfUid(dbc, OTHER), otherBefore });
    }

    /* ---- A step that fails part-way through an erasure is retried, and the erasure resumes (ERASE-CHUNK) ----
       A person with 1,508 rows (1,200 events, 300 daily totals and the rest), the purge at 06:00 UTC on
       Thursday 19 November 2026 with retention already finished that day. The cron's 06:15 step has its
       events statement refused by D1 (the whole step rolls back, and its share of the allowance stays
       spent); the 06:30 tick resumes; by 07:30 she is gone. A purge whose only step fails (the 07:45 one,
       for a second person) still leaves the erasure on record. */
    {
      const dbf = hooked();
      seedHeavy(dbf, HEAVY, 'hhHeavy01', 1200, 300);
      const T0 = Date.UTC(2026, 10, 19, 6, 0, 0);
      dbf.raw.prepare("INSERT INTO usage_meta (key, value, at) VALUES ('retention_day', '2026-11-19', 1), ('retention_rows', '2026-11-19:0', 1)").run();
      const envf = { USAGE_DB: dbf, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
      await atClock(T0, () => post(envf, '/api/account/purge', { idToken: idToken(HEAVY) }));
      const afterFirst = rowsOfUid(dbf, HEAVY);
      failSql = /^DELETE FROM usage_events WHERE \(who, id\) IN \(SELECT who, id FROM usage_events e WHERE \(uid, visit\) IN \(SELECT uid, visit FROM usage_events INDEXED BY ue_uid_at WHERE uid = \?1/; failLeft = 1; failKey = null;
      const errAt = errs.length;
      await atClock(T0 + 15 * MIN_MS, () => w.scheduled({}, envf));
      ok('staged: the 06:15 step failed on its events statement', failLeft === 0 && errs.slice(errAt).some((e) => /usage_pending_erase_fail/.test(e)), errs.slice(errAt));
      ok('a failed step changes nothing (one transaction) and keeps the marker', rowsOfUid(dbf, HEAVY) === afterFirst && afterFirst > 0 && markers(dbf, core.PENDING_UID) === 1, { afterFirst, now: rowsOfUid(dbf, HEAVY) });
      failSql = null;
      for (let k = 2; k <= 6; k++) await atClock(T0 + k * 15 * MIN_MS, () => w.scheduled({}, envf));
      ok('the next ticks resume it and finish: no row of hers, her marker held (pinned 19 November 2026, 07:30 UTC)', rowsOfUid(dbf, HEAVY) === 0 && markers(dbf, core.PENDING_UID) === 1, { left: rowsOfUid(dbf, HEAVY), markers: markers(dbf, core.PENDING_UID) });
      // A small erasure whose one step fails inside the purge request itself.
      seed2(dbf, OTHER, 'hhOther02');
      failSql = /^DELETE FROM usage_daily WHERE rowid IN/; failLeft = 1;
      const pr = await atClock(T0 + 105 * MIN_MS, () => post(envf, '/api/account/purge', { idToken: idToken(OTHER) }));
      ok('staged: a purge whose only step fails answers 500, and leaves her rows', failLeft === 0 && pr.status === 500 && rowsOfUid(dbf, OTHER) > 0, { pr, left: rowsOfUid(dbf, OTHER) });
      ok('and still puts the erasure on record', count(dbf, 'usage_meta', "key = 'erase_uid:" + OTHER + "'") === 1);
      failSql = null;
      await atClock(T0 + 120 * MIN_MS, () => w.scheduled({}, envf));
      ok('so the next tick erases her, the failed purge having left her marker due at once (pinned 19 November 2026, 08:00 UTC)', rowsOfUid(dbf, OTHER) === 0, { left: rowsOfUid(dbf, OTHER), markers: markers(dbf, core.PENDING_UID) });
      await atClock(T0 + 105 * MIN_MS + core.ERASE_HOLD_MS, () => w.scheduled({}, envf));
      ok('and both markers clear once their holds are over (pinned 19 November 2026, 13:45 UTC)', markers(dbf, core.PENDING_UID) === 0, markers(dbf, core.PENDING_UID));
    }

    /* ---- Retention and erasure share ONE daily allowance (ERASE-CHUNK) ----
       Cap 1,000: an allowance of 2,250 rows a day, 2,100 of it held for retention until it has run. A purge
       at 05:00 UTC on Saturday 21 November 2026, before that day's retention, of a person with 400 rows;
       then the 06:00 tick, with 3,000 anonymous rows past 30 days waiting. The erasure takes only the 150
       beyond retention's hold, retention takes what is left of the 2,250, and the day never passes it. */
    {
      const dbs2 = fresh();
      seedHeavy(dbs2, HEAVY, 'hhHeavy01', 300, 92);
      const ACUT = Date.UTC(2026, 10, 21, 6, 0, 0) - 30 * DAY_MS;
      const insa = dbs2.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,device,visit,platform,os,browser,app_version,name,props) VALUES ('anon_d_k3j9x2m7q1aa', ?, ?, ?, '2026-10-20', 6, 'UTC', NULL, 'd_k3j9x2m7q1aa', ?, 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{\"screen\":\"signin\"}')");
      dbs2.raw.exec('BEGIN'); for (let i = 0; i < 3000; i++) insa.run('sa' + i, ACUT - DAY_MS - i, ACUT - DAY_MS - i, 'v_sa' + i); dbs2.raw.exec('COMMIT');
      const envs2 = { USAGE_DB: dbs2, USAGE_DAILY_CAP: '1000', FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
      const all = () => count(dbs2, 'usage_events') + count(dbs2, 'usage_daily') + count(dbs2, 'devices') + count(dbs2, 'membership') + count(dbs2, 'nudges') + count(dbs2, 'shared_entries');
      const b0 = all();
      await atClock(Date.UTC(2026, 10, 21, 5, 0, 0), () => post(envs2, '/api/account/purge', { idToken: idToken(HEAVY) }));
      const erased = b0 - all();
      await atClock(Date.UTC(2026, 10, 21, 6, 0, 0), () => w.scheduled({}, envs2));
      const day = b0 - all();
      ok('before retention\'s run, an erasure takes only what lies beyond retention\'s hold (' + erased + ' of 150)', erased > 0 && erased <= 148, erased);
      ok('and retention then takes only what is left, so the UTC day deletes at most the one allowance (' + day + ' of 2,250)', day <= 2250 && day >= 2200, { erased, day });
    }

    /* ---- A household bigger than one step, with a visit that straddled a move (ERASE-CHUNK) ----
       hhBig01 carries 1,500 rows of its own, and one visit of a caregiver that moved to hhNew02 part-way:
       one row of it carries hhBig01, 1,100 carry hhNew02. Every row of that visit must go, across steps, so
       the rows that do NOT carry the household go before the row that does: it is how a later step finds the
       visit. A visit of hers wholly in hhNew02 stays. Pinned: Friday 20 November 2026, 06:00 UTC onwards,
       retention already finished that day. */
    {
      const dbh = hooked();
      const CG = 'uidCarer000000000000000006';
      const T = Date.UTC(2026, 10, 20, 5, 0, 0);
      const ins = dbh.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,role,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-11-20', 5, 'UTC', ?, ?, 'caregiver', 'd_carer0000002', ?, 'browser', 'macOS', 'Safari', 'v369', ?, '{}')");
      dbh.raw.exec('BEGIN');
      for (let i = 0; i < 1500; i++) ins.run(ME, 'b' + i, T - i, T - i, ME, 'hhBig01', 'v_b' + Math.floor(i / 5), i % 5 ? 'screen.viewed' : 'visit.started');
      ins.run(CG, 'mv-head', T - 5000, T - 5000, CG, 'hhBig01', 'v_moved01', 'visit.started');
      for (let i = 0; i < 1100; i++) ins.run(CG, 'mv' + i, T - 4000 + i, T - 4000 + i, CG, 'hhNew02', 'v_moved01', 'screen.viewed');
      ins.run(CG, 'stay', T, T, CG, 'hhNew02', 'v_stays01', 'visit.started');
      dbh.raw.exec('COMMIT');
      dbh.raw.prepare("INSERT INTO usage_meta (key, value, at) VALUES ('retention_day', '2026-11-20', 1), ('retention_rows', '2026-11-20:0', 1)").run();
      docs.set('households/hhBig01', { deleteAfter: { integerValue: '1' } }); dueHouseholds = ['hhBig01'];
      const envh = { USAGE_DB: dbh, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
      const T0 = Date.UTC(2026, 10, 20, 6, 0, 0);
      const hhRows = () => count(dbh, 'usage_events', "hid = 'hhBig01' OR visit = 'v_moved01'");
      const stepsH = recordSteps(dbh);
      const before = hhRows();
      for (let k = 0; k < 5; k++) await atClock(T0 + k * 15 * MIN_MS, () => w.scheduled({}, envh));
      dueHouseholds = [];
      ok('(staged: ' + before + ' rows of the household and its moved visit)', before === 2601 && !docs.has('households/hhBig01'), before);
      ok('a household bigger than one step goes in steps of at most ' + core.ERASE_CHUNK + ' rows (' + stepsH.join(', ') + ')', stepsH.length >= 3 && stepsH.every((g) => g <= core.ERASE_CHUNK), stepsH);
      ok('and every row of a visit that carried it goes, the rows carrying the new family too', hhRows() === 0 && count(dbh, 'usage_events', "visit = 'v_moved01'") === 0, { left: hhRows(), moved: count(dbh, 'usage_events', "visit = 'v_moved01'") });
      ok('and the marker clears with the last of them', markers(dbh, core.PENDING_HID) === 0, markers(dbh, core.PENDING_HID));
      ok('companion: her visit wholly in the new family stays, and so does every row of the other person', count(dbh, 'usage_events', "id = 'stay'") === 1);
    }

    /* ---- A step that stops inside a dose visit never leaves it showing its minute (F5, SE-V1) ----
       A step deletes at most 1,000 rows, so it can stop inside a visit, and what is left of that visit is what
       the admin reads. It shows a visit's minute only while the visit holds its visit.started AND its
       visit.ended row and no dose; this asks its real Visits tab (workers/admin/src/usage.mjs usageTab).
       Row ids are random, so a visit's rows can be read in any order; here a dose's row id sorts first and its
       head and end last. Two first steps that stop inside a dose visit, retention finished for the day,
       pinned to Friday 20 November 2026, 09:00 UTC:
       - her account: a membership row, 997 rows of visits whose ids sort before the dose visit, then the
         dose visit (head, dose, two screens, end);
       - a household: a caregiver who moved to another family part-way. Visit v_0000000a has its head and end
         in the purged household and its dose in her new one; v_a0000000 has its head in the purged household
         and 20 rows in the new one; v_zzzzzzzz has its head in the purged household and its dose, a screen
         and its end in the new one. Its erasure is taken ONE ROW A STEP (an allowance of three a day, a
         day a step, from 09:00 UTC on 20 November 2026), so every place a step can stop is tried, and the
         admin is asked after each one.
       With no order, each step took a dose and left that visit's head and end. */
    {
      const admin = await import('file://' + path.join(ROOT, 'workers', 'admin', 'src', 'usage.mjs'));
      const T = Date.UTC(2026, 10, 20, 8, 0, 0), STEP_AT = Date.UTC(2026, 10, 20, 9, 0, 0);
      const HEADP = '{"opened_from":"icon","start":"cold"}', ENDP = '{"reason":"hidden","seconds":4}', DOSE = '{"action":"logged","feature":"medicine"}', HOME = '{"screen":"home"}';
      const put = (db, uid, hid, id, at, visit, name, props) => db.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,role,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-11-20', 8, 'UTC', ?, ?, 'owner', 'd_k3j9x2m7q1aa', ?, 'browser', 'macOS', 'Safari', 'v369', ?, ?)")
        .run(uid, id, at, at, uid, hid, visit, name, props);
      let k = 0;
      const uuid = () => '5' + (++k).toString(16).padStart(7, '0') + '-0000-4000-8000-000000000000';
      const doneToday = (db) => db.raw.prepare("INSERT INTO usage_meta (key, value, at) VALUES ('retention_day', '2026-11-20', 1), ('retention_rows', '2026-11-20:0', 1)").run();
      /* What the admin's Visits tab shows of one visit: listed or not, and to the minute or the hour. */
      const shown = async (db, uid, visit) => {
        const t = await admin.usageTab({ usage: db, internal: new Set([uid]) }, 'visits', false, 1, true);
        const v = (t.rows || []).find((r) => r.visit === visit);
        return { listed: !!v, minute: !!v && !v.hourOnly, rows: count(db, 'usage_events', "visit = '" + visit + "'") };
      };
      // Her account.
      const dbp = fresh();
      dbp.raw.exec('BEGIN');
      for (let v = 0; v < 199; v++) for (let j = 0; j < 5; j++) {
        put(dbp, ME, 'hhMine01', uuid(), T - 1e6 + v * 10 + j, 'v_a' + String(v).padStart(7, '0'), j === 0 ? 'visit.started' : j === 4 ? 'visit.ended' : 'screen.viewed', j === 0 ? HEADP : j === 4 ? ENDP : HOME);
      }
      put(dbp, ME, 'hhMine01', uuid(), T - 5, 'v_b0000000', 'visit.started', HEADP);
      put(dbp, ME, 'hhMine01', uuid(), T - 4, 'v_b0000000', 'screen.viewed', HOME);
      put(dbp, ME, 'hhMine01', '11111111-0000-4000-8000-000000000000', T + 2000, 'v_zzzzzzzz', 'feature.used', DOSE);
      put(dbp, ME, 'hhMine01', '22222222-0000-4000-8000-000000000000', T + 3000, 'v_zzzzzzzz', 'screen.viewed', HOME);
      put(dbp, ME, 'hhMine01', '33333333-0000-4000-8000-000000000000', T + 4000, 'v_zzzzzzzz', 'screen.viewed', '{"screen":"log_medicine"}');
      put(dbp, ME, 'hhMine01', 'eeeeeeee-0000-4000-8000-000000000000', T + 1000, 'v_zzzzzzzz', 'visit.started', HEADP);
      put(dbp, ME, 'hhMine01', 'ffffffff-0000-4000-8000-000000000000', T + 5000, 'v_zzzzzzzz', 'visit.ended', ENDP);
      dbp.raw.prepare("INSERT INTO membership (uid, hid, role, notice, checked_at) VALUES (?, 'hhMine01', 'owner', '', 1)").run(ME);
      dbp.raw.exec('COMMIT');
      doneToday(dbp);
      const clean = await shown(dbp, ME, 'v_a0000000'), dose0 = await shown(dbp, ME, 'v_zzzzzzzz');
      ok('companion: the same reading of the admin finds a whole visit with no dose shown to the minute, and the dose visit listed by its hour', clean.minute && dose0.listed && !dose0.minute, { clean, dose0 });
      const sp = await core.eraseUid(dbp, ME, STEP_AT, BUDGET);
      const dose1 = await shown(dbp, ME, 'v_zzzzzzzz');
      ok('(staged: her first step took 1,000 rows and stopped short of the last few)', sp.erased === 1000 && !sp.done && rowsOfUid(dbp, ME) > 0, { sp, left: rowsOfUid(dbp, ME) });
      ok('a person\'s step that stops inside a dose visit leaves nothing of it the admin shows to the minute (F5, SE-V1)', !dose1.minute, dose1);
      // The household.
      const dbq = fresh();
      const CG = 'uidCarer000000000000000006', GONE = 'hhCut01', NEW = 'hhNew03';
      dbq.raw.exec('BEGIN');
      put(dbq, CG, GONE, 'eeeeeeee-0000-4000-8000-00000000000a', T - 2e6, 'v_0000000a', 'visit.started', HEADP);
      put(dbq, CG, NEW, '11111111-0000-4000-8000-00000000000a', T - 2e6 + 1000, 'v_0000000a', 'feature.used', DOSE);
      put(dbq, CG, GONE, 'ffffffff-0000-4000-8000-00000000000a', T - 2e6 + 2000, 'v_0000000a', 'visit.ended', ENDP);
      put(dbq, CG, GONE, uuid(), T - 1e6, 'v_a0000000', 'visit.started', HEADP);
      for (let i = 0; i < 20; i++) put(dbq, CG, NEW, uuid(), T - 1e6 + 1 + i, 'v_a0000000', 'screen.viewed', HOME);
      put(dbq, CG, GONE, 'eeeeeeee-0000-4000-8000-000000000000', T + 1000, 'v_zzzzzzzz', 'visit.started', HEADP);
      put(dbq, CG, NEW, '11111111-0000-4000-8000-000000000000', T + 2000, 'v_zzzzzzzz', 'feature.used', DOSE);
      put(dbq, CG, NEW, '22222222-0000-4000-8000-000000000000', T + 3000, 'v_zzzzzzzz', 'screen.viewed', HOME);
      put(dbq, CG, NEW, 'ffffffff-0000-4000-8000-000000000000', T + 5000, 'v_zzzzzzzz', 'visit.ended', ENDP);
      dbq.raw.exec('COMMIT');
      doneToday(dbq);
      const a0 = await shown(dbq, CG, 'v_0000000a'), z0 = await shown(dbq, CG, 'v_zzzzzzzz');
      await core.markHidErase(dbq, GONE, STEP_AT);
      const ONE = { allowance: 3, dayMax: 0 };   // one row a step, after the step's own two
      const total = count(dbq, 'usage_events'), seen = [];
      const sh = await core.eraseHid(dbq, GONE, STEP_AT, ONE);
      seen.push({ step: 1, erased: sh.erased, a: await shown(dbq, CG, 'v_0000000a'), z: await shown(dbq, CG, 'v_zzzzzzzz') });
      for (let s = 1; s < 60 && pending(dbq) > 0; s++) {
        await core.erasePending(dbq, STEP_AT + s * DAY_MS, ONE);
        seen.push({ step: s + 1, a: await shown(dbq, CG, 'v_0000000a'), z: await shown(dbq, CG, 'v_zzzzzzzz') });
      }
      const minute = seen.filter((x) => x.a.minute || x.z.minute);
      ok('(staged: before, both dose visits are listed by their hour; the household\'s first step took one row of its ' + total + ')', a0.listed && !a0.minute && z0.listed && !z0.minute && sh.erased === 1 && !sh.done, { a0, z0, sh });
      ok('a household\'s erasure, one row a step, never leaves a moved caregiver\'s dose visit shown to the minute, at any of its ' + seen.length + ' steps (F5, SE-V1)', minute.length === 0 && seen.length >= total, minute.slice(0, 3));
      ok('and the steps finish both: no row of the household or of its visits is left, and its marker is gone', count(dbq, 'usage_events', "hid = '" + GONE + "' OR visit IN ('v_0000000a', 'v_a0000000', 'v_zzzzzzzz')") === 0 && pending(dbq) === 0,
        count(dbq, 'usage_events'));
    }

    /* ---- A household erasure, a batch of its visits at a time, F5 at every step (SE-V1, SK2-2) ----
       A household's steps go a batch of its visits at a time (core.mjs VISITS_OF_HID), so each step reads
       about one batch, not every row the household has. Here a household of 14,745 rows: first, 4,000 visits
       that are a head and nothing else (a phone in a crash loop), the oldest rows it has; an owner's 700
       visits; two caregivers who moved to another family part-way, with a visit of every shape (head, dose,
       end and two screens each in the purged household or the other one, 72 shapes, twelve times); 260
       visits whose head alone carries the household (five of them 400 rows long); a row carrying it with no
       uid; and 48 visits wholly in the other family, which stay. Its erasure runs in 153 steps of 9 to 181
       rows, a UTC day apart from Friday 20 November 2026, 08:00 UTC, and the admin's real Visits tab is
       asked after every one. On D1 (usage-d1 runs this file on workerd's own D1) each step's rows READ are
       measured too: about 27,000 a step and 40,866 at the most; a batch that read the household's heads to
       learn whether any other row was left read 77,416 at the most here, and more with every head-only visit.
       On the shim nothing meters reads, so that check measures nothing there.
       Opt-in for the self-test (`hh`), as the long simulations are (`sim`). */
    if (opts.sim || opts.hh) {
      const admin = await import('file://' + path.join(ROOT, 'workers', 'admin', 'src', 'usage.mjs'));
      const dbe = fresh();
      const sqls = [];
      const realPrep = dbe.prepare.bind(dbe);
      dbe.prepare = (q) => { sqls.push(q); return realPrep(q); };
      const H = 'hhPurged01', G = 'hhOther001';
      const A = 'uidOwnerA000000000000000001', C = 'uidCarerC000000000000000002', E = 'uidCarerE000000000000000003';
      const HEADP = '{"opened_from":"icon","start":"cold"}', ENDP = '{"reason":"hidden","seconds":4}', DOSE = '{"action":"logged","feature":"medicine"}', HOME = '{"screen":"home"}';
      const T = Date.UTC(2026, 10, 20, 8, 0, 0);
      let rn = 0, at = T - 40 * DAY_MS;
      const ins = dbe.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,role,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-11-20', 8, 'UTC', ?, ?, 'owner', 'd_k3j9x2m7q1aa', ?, 'browser', 'macOS', 'Safari', 'v369', ?, ?)");
      // Row ids in no order of their own (a hash), so a visit's rows are read in any order.
      const put = (uid, hid, visit, name, props) => { rn++; at += 1000 + (rn * 7919) % 5000;
        ins.run(uid, (rn * 2654435761 % 4294967296).toString(16).padStart(8, '0') + '-0000-4000-8000-' + String(rn).padStart(12, '0'), at, at, uid, hid, visit, name, props); };
      let vk = 0;
      const vid = () => 'v_' + (++vk).toString(36).padStart(8, '0');
      const doses = new Set(), touched = new Set(), stays = new Set();
      dbe.raw.exec('BEGIN');
      for (let i = 0; i < 4000; i++) { const v = vid(); put(i % 2 ? C : E, H, v, 'visit.started', HEADP); touched.add((i % 2 ? C : E) + v); }
      const shapes = [];
      for (const hh of [H, G]) for (const dh of [H, G, null]) for (const eh of [H, G, null]) for (const s1 of [H, G]) for (const s2 of [H, G]) shapes.push([hh, dh, eh, s1, s2]);
      for (let rep = 0; rep < 12; rep++) for (const [hh, dh, eh, s1, s2] of shapes) {
        const v = vid(), who = rep % 2 ? C : E;
        put(who, hh, v, 'visit.started', HEADP); put(who, s1, v, 'screen.viewed', HOME);
        if (dh) { put(who, dh, v, 'feature.used', DOSE); doses.add(who + v); }
        put(who, s2, v, 'screen.viewed', HOME);
        if (eh) put(who, eh, v, 'visit.ended', ENDP);
        ([hh, dh, eh, s1, s2].includes(H) ? touched : stays).add(who + v);
      }
      for (let i = 0; i < 700; i++) {
        const v = vid();
        put(A, H, v, 'visit.started', HEADP); put(A, H, v, 'screen.viewed', HOME);
        if (i % 3 === 0) { put(A, H, v, 'feature.used', DOSE); doses.add(A + v); }
        put(A, H, v, 'screen.viewed', HOME); if (i % 7) put(A, H, v, 'visit.ended', ENDP);
        touched.add(A + v);
      }
      for (let i = 0; i < 260; i++) {
        const v = vid(), who = i % 2 ? C : E;
        put(who, H, v, 'visit.started', HEADP);
        for (let j = 0; j < (i % 50 === 0 ? 400 : 4); j++) put(who, G, v, 'screen.viewed', HOME);
        if (i % 2) { put(who, G, v, 'feature.used', DOSE); doses.add(who + v); }
        put(who, G, v, 'visit.ended', ENDP);
        touched.add(who + v);
      }
      dbe.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,role,device,visit,platform,os,browser,app_version,name,props) VALUES ('anon_d_k3j9x2m7q1aa', 'stray-1', 1, 1, '2026-11-20', 8, 'UTC', NULL, ?, NULL, 'd_k3j9x2m7q1aa', 'v_stray001', 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{}')").run(H);
      dbe.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES ('2026-11-15', ?, ?, 'browser', 'visits', '', 1)").run(A, H);
      dbe.raw.prepare("INSERT INTO membership (uid, hid, role, notice, checked_at) VALUES (?, ?, 'owner', '', 1)").run(A, H);
      dbe.raw.exec('COMMIT');
      const total = count(dbe, 'usage_events');
      const cfg = { usage: dbe, internal: new Set([A, C, E]) };
      const minuteDoses = async () => ((await admin.usageTab(cfg, 'visits', false, 1, true)).rows || []).filter((r) => !r.hourOnly && doses.has(r.uid + r.visit)).map((r) => r.visit);
      const before = await minuteDoses();
      const bad = [];
      await core.markHidErase(dbe, H, T);
      // Rows READ by each step, from D1's own meter; the shim has none.
      const read = [], meter = () => (dbe.meter ? dbe.meter.rows_read : 0);
      let r0 = meter();
      const first = await core.eraseHid(dbe, H, T, { allowance: 503, dayMax: 0 });
      read.push(meter() - r0);
      bad.push(...(await minuteDoses()).map((v) => 'step 1 ' + v));
      let steps = 1;
      for (let k = 1; k < 3000 && pending(dbe) > 0; k++) {
        r0 = meter();
        await core.erasePending(dbe, T + k * DAY_MS, { allowance: 9 + ((k * 7919) % 173), dayMax: 0 }, 1);
        read.push(meter() - r0);
        steps++;
        bad.push(...(await minuteDoses()).map((v) => 'step ' + steps + ' ' + v));
      }
      const left = new Set(dbe.raw.prepare('SELECT uid, visit FROM usage_events').all().map((x) => x.uid + x.visit));
      const leftTouched = [...touched].filter((x) => left.has(x)).length;
      ok('(staged: ' + total + ' rows, ' + doses.size + ' dose visits, each listed by its hour before; the first step took ' + first.erased + ')', total === 14745 && doses.size === 940 && before.length === 0 && first.erased === 501 && !first.done, { total, doses: doses.size, before: before.length, first });
      ok('a household\'s erasure in ' + steps + ' steps never leaves a dose visit shown to the minute, at any step (F5, SE-V1, SK2-2)', bad.length === 0 && steps > 100, { steps, bad: bad.slice(0, 5) });
      ok('and it finishes: no row of the household, none of a visit that carried it, the stray included, and its marker is gone (SK2-2)', leftTouched === 0 && count(dbe, 'usage_events', "hid = '" + H + "'") === 0 && pending(dbe) === 0
        && count(dbe, 'usage_daily', "hid = '" + H + "'") === 0, { leftTouched, hid: count(dbe, 'usage_events', "hid = '" + H + "'"), pending: pending(dbe) });
      ok('companion: the 48 visits wholly in the other family stay', [...stays].every((x) => left.has(x)) && stays.size === 48, stays.size);
      /* The bound, on D1's meter: what a batch of 1,001 rows and its visits read, whatever else the household
         holds (40,866 at the most, measured). Before, its 4,000 head-only visits were read again by every
         statement of every step (77,416). */
      const most = Math.max(...read);
      ok('on D1, no step of it reads more than 50,000 rows, whatever else the household holds (SK2-2; usage-d1 measures it, the shim cannot)', !dbe.meter || (most > 0 && most <= 50000),
        { engine: dbe.meter ? 'D1' : 'shim', most, at: read.indexOf(most) + 1, first: read.slice(0, 4) });
      const visitLists = sqls.filter((q) => /\(uid, visit\) IN \(SELECT/.test(q));
      ok('every statement that names the household\'s visits names a batch of ' + (core.ERASE_CHUNK + 1) + ' rows at most, never all of them (SK2-2)', visitLists.length > 0
        && visitLists.every((q) => (q.match(/\(uid, visit\) IN \(SELECT/g) || []).length === (q.match(new RegExp('ORDER BY at LIMIT ' + (core.ERASE_CHUNK + 1) + '\\)', 'g')) || []).length),
        visitLists.filter((q) => !/ORDER BY at LIMIT/.test(q)).map((q) => q.slice(0, 160)).slice(0, 2));
    }

    /* ---- During a retention backlog, an erasure still has its floor (SE-V2) ----
       Cap 1,000: an allowance of 2,250 rows a UTC day, retention's part 2,100 and the erasures' floor 150.
       After an outage, 6,000 anonymous rows wait past 30 days, more than two days of the allowance. A person
       with 400 usage rows deletes her account at 09:00 UTC on Monday 23 November 2026. Before, retention took
       the whole allowance at the day's first tick, and her purge got nothing, not even her membership row,
       until the backlog was gone. Ticks at 00:00, 00:15, 09:15 and 23:45 UTC on the 23rd, 24th and 25th. */
    {
      const dbb = fresh();
      seedHeavy(dbb, HEAVY, 'hhHeavy01', 300, 92);
      const D0 = Date.UTC(2026, 10, 23, 0, 0, 0), ACUT = D0 - 30 * DAY_MS;
      const insb = dbb.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,device,visit,platform,os,browser,app_version,name,props) VALUES ('anon_d_k3j9x2m7q1aa', ?, ?, ?, '2026-10-20', 6, 'UTC', NULL, 'd_k3j9x2m7q1aa', ?, 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{\"screen\":\"signin\"}')");
      dbb.raw.exec('BEGIN'); for (let i = 0; i < 6000; i++) insb.run('bk' + i, ACUT - DAY_MS - i, ACUT - DAY_MS - i, 'v_bk' + i); dbb.raw.exec('COMMIT');
      const envb = { USAGE_DB: dbb, USAGE_DAILY_CAP: '1000', FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
      const allowance = wmod.__usage.retentionDailyRows(envb);
      const all = () => count(dbb, 'usage_events') + count(dbb, 'usage_daily') + count(dbb, 'devices') + count(dbb, 'membership') + count(dbb, 'nudges') + count(dbb, 'shared_entries');
      const total = rowsOfUid(dbb, HEAVY);
      const byDay = {}, anonByDay = {};
      const tick = async (t, fn) => {
        const a = all(), an = count(dbb, 'usage_events', 'uid IS NULL');
        await atClock(t, fn || (() => w.scheduled({}, envb)));
        const d = new Date(t).toISOString().slice(0, 10);
        byDay[d] = (byDay[d] || 0) + a - all(); anonByDay[d] = (anonByDay[d] || 0) + an - count(dbb, 'usage_events', 'uid IS NULL');
      };
      await tick(D0); await tick(D0 + 15 * MIN_MS);
      const before = rowsOfUid(dbb, HEAVY);
      await tick(D0 + 9 * 60 * MIN_MS, () => post(envb, '/api/account/purge', { idToken: idToken(HEAVY) }));
      const first = before - rowsOfUid(dbb, HEAVY);
      ok('(staged: ' + total + ' rows of hers, and retention took its part of the 23rd before her purge)', total === 400 && anonByDay['2026-11-23'] === 2100, { total, anon: anonByDay });
      ok('during a backlog her purge still erases at once: her membership row goes, and as much as the erasures\' floor allows (' + first + ' of 148) (SE-V2)',
        count(dbb, 'membership', "uid = '" + HEAVY + "'") === 0 && first > 0 && first <= 148, { first });
      for (const d of [0, 1, 2]) for (const m of (d ? [0, 15, 555, 1425] : [555, 1425])) await tick(D0 + d * DAY_MS + m * MIN_MS);
      ok('and the cron carries her erasure on through the backlog, a floor a day, until no row of hers is left (pinned 25 November 2026, 23:45 UTC)', rowsOfUid(dbb, HEAVY) === 0, { left: rowsOfUid(dbb, HEAVY), byDay });
      ok('while the backlog keeps retention\'s part every day (' + Object.values(anonByDay).join(', ') + ' anonymous rows a day)', anonByDay['2026-11-24'] >= 2100 && anonByDay['2026-11-25'] >= 1500, anonByDay);
      ok('and no UTC day deletes more than the one allowance (' + Object.values(byDay).join(', ') + ' of ' + allowance + ')', Object.values(byDay).every((g) => g <= allowance), byDay);
    }

    /* ---- An erasure step taken while retention is running never takes the day past the allowance (SE-V3) ----
       Cap 1,000 (allowance 2,250: retention's 2,100, the erasures' floor 150) and 5,000 anonymous rows past 30
       days. An account purge comes in while the cron's retention is running: staged by running it inside
       retention's first anonymous delete. Once at 06:00 UTC on Thursday 26 November 2026, before the day's last
       tick; once, on another day's database, at 23:45 UTC, the last tick, when retention takes what the
       erasures left of their floor. Before, retention read the erasures' counter once, at its start, and
       planned the whole allowance less that, so a step taken meanwhile came on top of it. */
    {
      const ANON_DELETE = /^DELETE FROM usage_events WHERE \(who, id\) IN \(SELECT who, id FROM usage_events WHERE uid IS NULL/;
      /* Runs `fn` once, just before the first anonymous retention delete runs. */
      const during = (db, fn) => {
        const real = db.prepare.bind(db);
        let armed = true;
        const hold = (s) => Object.assign({}, s, { bind: (...a) => hold(s.bind(...a)), run: async () => { if (armed) { armed = false; await fn(); } return s.run(); } });
        db.prepare = (sql) => (ANON_DELETE.test(sql) ? hold(real(sql)) : real(sql));
        return () => !armed;
      };
      const staged = (D) => {
        const db = fresh();
        seedHeavy(db, HEAVY, 'hhHeavy01', 300, 92);
        const ins = db.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,device,visit,platform,os,browser,app_version,name,props) VALUES ('anon_d_k3j9x2m7q1aa', ?, ?, ?, '2026-10-20', 6, 'UTC', NULL, 'd_k3j9x2m7q1aa', ?, 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{\"screen\":\"signin\"}')");
        db.raw.exec('BEGIN'); for (let i = 0; i < 5000; i++) ins.run('ip' + i, D - 31 * DAY_MS - i, D - 31 * DAY_MS - i, 'v_ip' + i); db.raw.exec('COMMIT');
        return db;
      };
      const allOf = (db) => count(db, 'usage_events') + count(db, 'usage_daily') + count(db, 'devices') + count(db, 'membership') + count(db, 'nudges') + count(db, 'shared_entries');
      const D = Date.UTC(2026, 10, 26, 0, 0, 0);
      const dbi = staged(D);
      const envi = { USAGE_DB: dbi, USAGE_DAILY_CAP: '1000', FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
      const allowance = wmod.__usage.retentionDailyRows(envi);
      const b0 = allOf(dbi), h0 = rowsOfUid(dbi, HEAVY);
      const fired = during(dbi, () => post(envi, '/api/account/purge', { idToken: idToken(HEAVY) }));
      await atClock(D + 6 * 60 * MIN_MS, () => w.scheduled({}, envi));
      ok('(staged: her purge ran inside retention\'s run and erased rows of hers)', fired() && rowsOfUid(dbi, HEAVY) < h0, { fired: fired(), left: rowsOfUid(dbi, HEAVY) });
      ok('a step taken while retention runs leaves the day inside the one allowance (' + (b0 - allOf(dbi)) + ' of ' + allowance + ', 06:00 UTC on 26 November 2026) (SE-V3)', b0 - allOf(dbi) <= allowance, b0 - allOf(dbi));
      // The day's last tick: retention takes the erasures' unused floor, and a purge inside it finds none.
      const D2 = Date.UTC(2026, 10, 27, 0, 0, 0);
      const dbl = staged(D2);
      const envl = { USAGE_DB: dbl, USAGE_DAILY_CAP: '1000', FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
      const c0 = allOf(dbl);
      await atClock(D2 + 6 * 60 * MIN_MS, () => w.scheduled({}, envl));
      const firedL = during(dbl, () => post(envl, '/api/account/purge', { idToken: idToken(HEAVY) }));
      await atClock(D2 + 1425 * MIN_MS, () => w.scheduled({}, envl));
      const anonGone = 5000 - count(dbl, 'usage_events', 'uid IS NULL');
      ok('(staged: at the last tick retention took the erasures\' unused floor too, and the purge ran inside it)', firedL() && anonGone === 2250, { fired: firedL(), anonGone });
      ok('so a step taken during the last tick finds no room left, and the day stays inside the one allowance (' + (c0 - allOf(dbl)) + ' of ' + allowance + ', 23:45 UTC on 27 November 2026) (SE-V3)',
        c0 - allOf(dbl) <= allowance && count(dbl, 'usage_meta', "key = 'erase_uid:" + HEAVY + "'") === 1, { day: c0 - allOf(dbl), her: rowsOfUid(dbl, HEAVY) });
    }

    /* ---- A pending erasure that fails every time never holds the others back (SE-V4) ----
       Three people's erasures have been pending since 03:00, 04:00 and 05:00 UTC on Saturday 28 November 2026,
       600 rows each, and every step of theirs fails (one statement too big for D1, say). A fourth, 300 rows,
       has been pending since 05:30. Retention has finished the day. A tick runs three steps. Before, the three
       that fail kept the oldest places and ran first on every tick, and the fourth never ran. Ticks at 06:00,
       06:15 and 06:30 UTC. */
    {
      const dbx = hooked();
      const FAILING = ['uidFails00000000000000000001', 'uidFails00000000000000000002', 'uidFails00000000000000000003'], LAST = 'uidLast000000000000000000004';
      const D = Date.UTC(2026, 10, 28, 0, 0, 0);
      const seedN = (uid, n) => {
        const ins = dbx.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,role,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-11-27', 12, 'UTC', ?, 'hhX01', 'owner', 'd_x00000000001', ?, 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{\"screen\":\"home\"}')");
        dbx.raw.exec('BEGIN');
        for (let i = 0; i < n - 1; i++) ins.run(uid, 'x' + i, D - DAY_MS + i, D - DAY_MS + i, uid, 'v_x' + Math.floor(i / 5));
        dbx.raw.prepare("INSERT INTO membership (uid, hid, role, notice, checked_at) VALUES (?, 'hhX01', 'owner', '', 1)").run(uid);
        dbx.raw.exec('COMMIT');
      };
      FAILING.forEach((u, i) => { seedN(u, 600); dbx.raw.prepare('INSERT INTO usage_meta (key, value, at) VALUES (?, ?, ?)').run('erase_uid:' + u, String(D + (3 + i) * 60 * MIN_MS), D + (3 + i) * 60 * MIN_MS); });
      seedN(LAST, 300);
      dbx.raw.prepare('INSERT INTO usage_meta (key, value, at) VALUES (?, ?, ?)').run('erase_uid:' + LAST, String(D + 330 * MIN_MS), D + 330 * MIN_MS);
      dbx.raw.prepare("INSERT INTO usage_meta (key, value, at) VALUES ('retention_day', '2026-11-28', 1), ('retention_rows', '2026-11-28:0', 1)").run();
      const envx = { USAGE_DB: dbx, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
      failSql = /^DELETE FROM /; failKey = 'uidFails'; failLeft = 1e9;
      const errAt = errs.length;
      const leftOf = (u) => count(dbx, 'usage_events', "uid = '" + u + "'") + count(dbx, 'membership', "uid = '" + u + "'");
      await atClock(D + 360 * MIN_MS, () => w.scheduled({}, envx));
      ok('(staged: on the first tick the three oldest ran and failed, and the fourth waited)', leftOf(LAST) === 300 && FAILING.every((u) => leftOf(u) === 600) && errs.slice(errAt).some((e) => /usage_pending_erase_fail/.test(e)), { last: leftOf(LAST), errs: errs.slice(errAt) });
      await atClock(D + 375 * MIN_MS, () => w.scheduled({}, envx));
      ok('an erasure whose steps keep failing goes to the back, so the next tick erases the one behind it (06:15 UTC on 28 November 2026) (SE-V4)', leftOf(LAST) === 0, { last: leftOf(LAST) });
      await atClock(D + 390 * MIN_MS, () => w.scheduled({}, envx));
      ok('companion: the three still fail, keep their markers and every row, and the day\'s counter stays inside the allowance', FAILING.every((u) => leftOf(u) === 600 && count(dbx, 'usage_meta', "key = 'erase_uid:" + u + "'") === 1)
        && (Number(meta(dbx, core.ceilingKey('erase', '2026-11-28'))) || 0) <= BUDGET.allowance, { counter: meta(dbx, core.ceilingKey('erase', '2026-11-28')) });
      failSql = null; failKey = null; failLeft = 0;
    }

    /* ---- A row stored while an erasure step runs is still erased (SE-V5) ----
       A batch of hers that was already on its way (the one sent as the app hides, say) is stored between a
       step's count and its delete. Twice, on Tuesday 1 December 2026, retention finished for the day:
       - her purge at 10:00 UTC, whose one step takes everything it counted. Before, it wrote no marker, and
         that row stayed with nothing but the weekly sweep to find it. Now her marker is held for the
         membership memory's life, and the cron's step at the end of the hold takes the row and clears it;
       - the cron step at 18:15 UTC that finishes a larger erasure, purged at 18:00. Its marker is not held
         for six hours while a row of hers is left: the next tick takes the row. */
    {
      const dbr = fresh();
      const T = Date.UTC(2026, 11, 1, 10, 0, 0), T2 = Date.UTC(2026, 11, 1, 18, 0, 0);
      dbr.raw.prepare("INSERT INTO usage_meta (key, value, at) VALUES ('retention_day', '2026-12-01', 1), ('retention_rows', '2026-12-01:0', 1)").run();
      seed2(dbr, OTHER, 'hhOther02');
      seedHeavy(dbr, HEAVY, 'hhHeavy01', 1100, 30);
      const late = (uid) => { for (const n of [1, 2]) dbr.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,hid,role,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-12-01', 10, 'UTC', ?, 'hhOther02', 'owner', 'd_k3j9x2m7q1aa', 'v_late0001', 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{\"screen\":\"home\"}')")
        .run(uid, 'late' + n + '-' + uid, Date.now(), Date.now(), uid); };
      /* Stores two rows of `lateFor` (one batch of hers) just before the next batch that deletes usage events
         of hers runs. */
      const realBatch = dbr.batch.bind(dbr);
      let lateFor = null;
      dbr.batch = async (list) => {
        if (lateFor && list.some((s) => /^DELETE FROM usage_events/.test(s._sql) && s._args && s._args[0] === lateFor)) { late(lateFor); lateFor = null; }
        return realBatch(list);
      };
      const envr = { USAGE_DB: dbr, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
      lateFor = OTHER;
      const pr = await atClock(T, () => post(envr, '/api/account/purge', { idToken: idToken(OTHER) }));
      ok('(staged: her purge answered ok, its one step took all it counted, and rows of hers arrived between its count and its delete)', pr.status === 200 && lateFor === null && rowsOfUid(dbr, OTHER) > 0, { pr, left: rowsOfUid(dbr, OTHER) });
      ok('the purge put her erasure on record all the same (SE-V5)', count(dbr, 'usage_meta', "key = 'erase_uid:" + OTHER + "'") === 1);
      await atClock(T + core.ERASE_HOLD_MS, () => w.scheduled({}, envr));
      ok('and the cron erases those rows once her marker\'s hold is over, then clears the marker (pinned 1 December 2026, 16:00 UTC)', rowsOfUid(dbr, OTHER) === 0 && count(dbr, 'usage_meta', "key = 'erase_uid:" + OTHER + "'") === 0, { left: rowsOfUid(dbr, OTHER) });
      // The larger erasure: the purge leaves the rest to the cron, and a row lands inside the cron's last step.
      await atClock(T2, () => post(envr, '/api/account/purge', { idToken: idToken(HEAVY) }));
      lateFor = HEAVY;
      await atClock(T2 + 15 * MIN_MS, () => w.scheduled({}, envr));
      ok('(staged: the 18:15 step took the rest of hers it counted, and rows of hers arrived meanwhile)', lateFor === null && rowsOfUid(dbr, HEAVY) > 0, rowsOfUid(dbr, HEAVY));
      await atClock(T2 + 30 * MIN_MS, () => w.scheduled({}, envr));
      ok('rows left after the step that finished her erasure go on the next tick, not when her marker\'s hold ends (18:30 UTC)', rowsOfUid(dbr, HEAVY) === 0, rowsOfUid(dbr, HEAVY));
      ok('companion: and her marker is held from then on', count(dbr, 'usage_meta', "key = 'erase_uid:" + HEAVY + "'") === 1);
    }

    /* ---- A tick with no room left is cheap (SK2-2) ----
       A pending erasure is carried on every tick, 96 a day. Before, each tick ran its step's counts first and
       only then learned the day had no room, so a heavy erasure re-read the person's or the household's rows
       all day, every day it was pending: on D1 a 12,000-row household read about five million rows a UTC day
       that way, which is all D1 Free allows the whole account, games and newsletter included. Now the read
       that lists the due markers also reads where the day's allowance stands, and with no room no count
       runs. Every statement is logged. Thursday 3 December 2026: retention finished, the day's allowance all
       used, a person of 1,808 rows pending since the 2nd, ticks at 10:00, 10:15, 10:30 and 10:45 UTC; then
       the first tick of Friday 4 December (00:15 UTC), with room again. */
    {
      const sqls = [];
      const dbn = makeD1({ hooks: { before(sql) { sqls.push(sql); } } });
      dbn.raw.exec(schema);
      seedHeavy(dbn, HEAVY, 'hhHeavy01', 1500, 300);
      const envn = { USAGE_DB: dbn, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
      const allowance = wmod.__usage.retentionDailyRows(envn);
      const D = Date.UTC(2026, 11, 3, 0, 0, 0);
      dbn.raw.prepare("INSERT INTO usage_meta (key, value, at) VALUES ('retention_day', '2026-12-03', 1), ('retention_rows', ?, 1), (?, ?, ?)")
        .run('2026-12-03:' + allowance, 'erase_uid:' + HEAVY, String(D - DAY_MS), D - DAY_MS);
      const before = rowsOfUid(dbn, HEAVY);
      const counts = () => sqls.filter((q) => /COUNT\(\*\)/.test(q)).length;
      for (const m of [600, 615, 630, 645]) await atClock(D + m * MIN_MS, () => w.scheduled({}, envn));
      const dry = { counts: counts(), statements: sqls.length, left: rowsOfUid(dbn, HEAVY) };
      ok('(staged: ' + before + ' rows of hers pending, the day\'s allowance of ' + allowance + ' all used)', before === 1808 && dry.left === before
        && count(dbn, 'usage_meta', "key = 'erase_uid:" + HEAVY + "'") === 1, { before, dry });
      ok('a tick with no room runs no count: four ticks, ' + dry.statements + ' statements, none of them a COUNT (SK2-2)', dry.counts === 0 && dry.statements <= 4 * 2, { dry, sample: sqls.slice(0, 8).map((q) => q.slice(0, 90)) });
      await atClock(D + DAY_MS + 15 * MIN_MS, () => w.scheduled({}, envn));
      ok('companion: the first tick of the next UTC day has room, runs its count and erases (00:15 UTC, 4 December 2026)', counts() > 0 && rowsOfUid(dbn, HEAVY) < before, { counts: counts(), left: rowsOfUid(dbn, HEAVY) });
      ok('no statement of her erasure looks her rows up by who, which read every row she has in every count (SK2-2)', sqls.some((q) => /uid = \?1/.test(q)) && !sqls.some((q) => /\bwho = \?1/.test(q)),
        sqls.filter((q) => /\bwho = \?1/.test(q)).map((q) => q.slice(0, 120)));
      /* Her events go a batch of her visits at a time: before, the statement sorted every row she had to find
         the heads and the ends first, on every step (on D1 up to 24,234 rows a step at 10,000 rows of hers,
         204,234 at 100,000). */
      const evDeletes = sqls.filter((q) => /^DELETE FROM usage_events /.test(q) && q.includes("ORDER BY name IN ('visit.started', 'visit.ended') DESC"));
      const batchOf = 'INDEXED BY ue_uid_at WHERE uid = ?1 ORDER BY at LIMIT ' + (core.ERASE_CHUNK + 1) + ')';
      ok('each step takes her events from a batch of her visits, ' + (core.ERASE_CHUNK + 1) + ' rows of hers at most, never by sorting every row she has (SK2-2)',
        evDeletes.length > 0 && evDeletes.every((q) => q.includes(batchOf)), evDeletes.map((q) => q.slice(0, 200)));
    }

    /* ---- The worker's REAL Sunday orphan sweep (W6, F1) ----
       Sunday 15 November 2026, 06:00 UTC, through w.scheduled. Auth's accounts:lookup answers 503 first:
       a lookup failure must never read as "nobody exists". Then it answers, without OTHER. */
    const SUNDAY = Date.UTC(2026, 10, 15, 6, 0, 0);
    const db10 = fresh();
    for (const u of [ME, OTHER]) {
      db10.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES ('2026-11-14', ?, 'h', 'browser', 'visits', '', 1)").run(u);
      db10.raw.prepare("INSERT INTO devices (device, uid, platform, os, browser, app_version, first_seen, last_seen) VALUES (?, ?, 'browser', 'macOS', 'Safari', 'v369', 1, 1)").run('d_' + u.slice(3, 15).toLowerCase(), u);
    }
    const env10 = { USAGE_DB: db10, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
    const swept10 = () => (db10.raw.prepare("SELECT value FROM usage_meta WHERE key = 'sweep_day'").get() || {}).value || null;
    authKnown = new Set([ME]); authFails = true;
    const errAt10 = errs.length;
    await atClock(SUNDAY, () => w.scheduled({}, env10));
    authFails = false;
    ok('Sunday sweep, Auth failing: the real cron erases nobody', count(db10, 'usage_daily') === 2 && count(db10, 'devices') === 2, { daily: count(db10, 'usage_daily'), devices: count(db10, 'devices') });
    ok('Sunday sweep, Auth failing: the week is not marked swept, so the next tick asks again', swept10() === null, swept10());
    ok('Sunday sweep, Auth failing: logged by code', errs.slice(errAt10).some((e) => /usage_sweep_fail/.test(e)), errs.slice(errAt10));
    await atClock(SUNDAY + 15 * MIN_MS, () => w.scheduled({}, env10));
    ok('Sunday sweep, Auth answering: the uid it no longer has is erased', count(db10, 'usage_daily', "uid = '" + OTHER + "'") === 0 && count(db10, 'devices', "uid = '" + OTHER + "'") === 0);
    ok('Sunday sweep, Auth answering: the uid it still has is kept', count(db10, 'usage_daily', "uid = '" + ME + "'") === 1 && count(db10, 'devices', "uid = '" + ME + "'") === 1);
    ok('Sunday sweep, Auth answering: the week is marked swept (pinned: 2026-11-15)', swept10() === '2026-11-15', swept10());

    /* ---- The account purge: every hub she owns, with its games and guests' guesses, in one batch ---- */
    const THIRD = 'uidThird0000000000000000003';
    const g3 = makeD1();
    g3.raw.exec("CREATE TABLE hubs (code TEXT PRIMARY KEY, owner_uid TEXT, title TEXT, created_at INTEGER); CREATE TABLE hub_games (id TEXT PRIMARY KEY, hub_code TEXT, type TEXT, prompt TEXT, status TEXT DEFAULT 'open', result TEXT DEFAULT '', created_at INTEGER); CREATE TABLE hub_guesses (id TEXT PRIMARY KEY, game_id TEXT, hub_code TEXT, nickname TEXT, guess TEXT, note TEXT, relation TEXT, created_at INTEGER);");
    for (const [code, owner] of [['hubmine1', THIRD], ['hubmine2', THIRD], ['hubother', OTHER]]) {
      g3.raw.prepare("INSERT INTO hubs VALUES (?, ?, 'Baby guess', 1)").run(code, owner);
      g3.raw.prepare("INSERT INTO hub_games VALUES (?, ?, 'sex', '?', 'open', '', 1)").run('g_' + code, code);
      g3.raw.prepare("INSERT INTO hub_guesses VALUES (?, ?, ?, 'Auntie Sam', 'girl', 'so excited', 'aunt', 1)").run('q_' + code, 'g_' + code, code);
    }
    const pr3 = await post({ GAMES_DB: g3, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) }, '/api/account/purge', { idToken: idToken(THIRD) });
    ok('the account purge deletes every hub she owns, their games and every guest\'s guess', pr3.status === 200 && pr3.body.hubs === 2
      && g3.raw.prepare("SELECT COUNT(*) AS c FROM hubs WHERE owner_uid = ?").get(THIRD).c === 0
      && g3.raw.prepare("SELECT COUNT(*) AS c FROM hub_guesses WHERE hub_code LIKE 'hubmine%'").get().c === 0
      && g3.raw.prepare("SELECT COUNT(*) AS c FROM hub_games WHERE hub_code LIKE 'hubmine%'").get().c === 0, pr3);
    ok('companion: another person\'s hub, game and guests stay', g3.raw.prepare("SELECT COUNT(*) AS c FROM hub_guesses WHERE hub_code = 'hubother'").get().c === 1
      && g3.raw.prepare("SELECT COUNT(*) AS c FROM hubs WHERE code = 'hubother'").get().c === 1);

    /* ---- The D1 write arithmetic behind USAGE_DAILY_CAP (W4, ERA-SK-3, VI-3), in rows BILLED ----
       D1 bills one written row per row a statement inserts, updates or deletes, plus one per index entry the
       write touches: an INSERT or a DELETE touches every index of its table (an ordinary table's key index
       included), an UPDATE only the indexes holding a column it changes. Every term is computed from the
       REAL schema (sqlite_master, index_info), the REAL constants and the cap wrangler.toml ships, and the
       sum is checked against the figure the comment beside USAGE_DAILY_CAP states, in the same unit. It
       must stay under half of the 100,000 the account shares, with 3,000 to spare. */
    const toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
    const capToml = Number((/^USAGE_DAILY_CAP\s*=\s*"(\d+)"/m.exec(toml) || [])[1]);
    const sm = fresh().raw;
    const indexesOf = (t) => sm.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?").all(t).map((x) => x.name);
    const rowIns = (t) => 1 + indexesOf(t).length;                       // one row in or out, with every index entry
    const rowUpd = (t, cols) => 1 + indexesOf(t).filter((i) => sm.prepare('PRAGMA index_info(' + JSON.stringify(i) + ')').all().some((c) => cols.includes(c.name))).length;
    const sh = core.ceilingsOf({ USAGE_DAILY_CAP: String(capToml) });
    const counterUpd = rowUpd('usage_meta', ['value', 'at']);
    const perEvent = counterUpd + rowIns('usage_events') + rowIns('usage_daily') + rowIns('devices');   // a device id never seen is an INSERT (ERA-SK-3)
    const fill = 2 * sh.linked * rowUpd('usage_events', ['hid', 'role']);                              // two days of the families' share, each row once
    const refusals = core.REFUSED_DAILY_ROWS * (rowUpd('usage_refused', ['n']) + counterUpd) + core.REFUSED.length * (rowIns('usage_refused') - 1) + (rowIns('usage_meta') - 1);
    const membership = core.MEMBERSHIP_DAILY_ROWS * (counterUpd + rowIns('membership')) + (rowIns('usage_meta') - 1);
    const allowanceOf = wmod.__usage && wmod.__usage.retentionDailyRows;
    const allowance = allowanceOf ? allowanceOf({ USAGE_DAILY_CAP: String(capToml) }) : NaN;
    /* Retention and erasure share the allowance: every row either deletes, and an erasure step's own two
       rows (its counter's write, and its marker's: written, held, cleared, or after a failed step moved to
       the back of the queue), are taken from it, at 5 billed at most each. */
    const perDelete = Math.max(...['usage_events', 'usage_daily', 'usage_refused', 'devices', 'usage_meta', 'membership', 'nudges', 'shared_entries'].map(rowIns));
    const bought = counterUpd;                                                                         // retention taking the erasures' unused floor at the day's last tick, once
    const rest = 3 * (rowIns('usage_meta') - 1) + (96 + 2) * rowIns('usage_meta') + bought;            // the first write of the two shares' and the erasures' counters; the cron's markers
    const billed = capToml * perEvent + fill + refusals + membership + allowance * perDelete + rest;
    if (!quiet) console.log('  write arithmetic, rows billed: cap ' + capToml + ' x ' + perEvent + ' + fill ' + fill + ' + refusals ' + refusals + ' + membership ' + membership
      + ' + retention and erasure ' + allowance + ' x ' + perDelete + ' + ' + rest + ' = ' + billed);
    ok('(the schema bills 13 to store an event: counter 1, event 5, daily row 4, new device 3)', perEvent === 13 && counterUpd === 1 && rowIns('devices') === 3, { perEvent, counterUpd, devices: rowIns('devices') });
    ok('at USAGE_DAILY_CAP, the worst UTC day in rows billed stays under half the D1 allowance, with 3,000 to spare (' + billed + ')', capToml > 0 && billed <= 47000,
      { capToml, perEvent, fill, refusals, membership, allowance, perDelete, rest, billed });
    const stated = /^# At ([\d,]+) that is [\d,+ ]+ = ([\d,]+),/m.exec(toml);
    const num = (x) => Number(String(x).replace(/,/g, ''));
    ok('wrangler.toml states the same cap and the same total, in the same unit', !!stated && num(stated[1]) === capToml && num(stated[2]) === billed, { stated: stated && stated.slice(1), billed });
    ok('the retention allowance is more than a day of expiry at the cap (two caps), so nothing waits in steady state and a backlog drains', allowance >= 2 * capToml + 100, { allowance, capToml });
    /* What a day expires beyond two caps, recounted from the real constants (core.mjs RETENTION_DAY_EXTRA):
       the aggregate daily rows one local day can hold (every (metric, key) that dailyAdds gives a row with
       no person, on every platform), every refusal reason, and every day counter. */
    const aggKeys = new Set();
    const sample = (spec) => spec.enum ? spec.enum : spec.int ? [spec.int[0]] : [spec.format === 'version' ? 'v1' : 'n_abcdefgh'];
    for (const [name, spec] of Object.entries(core.USAGE_EVENTS)) {
      const keys = Object.keys(spec.props);
      const combos = keys.reduce((acc, k) => acc.flatMap((c) => sample(spec.props[k]).filter((v, i) => ['screen', 'feature', 'outcome'].includes(k) || i === 0).map((v) => Object.assign({}, c, { [k]: v }))), [{}]);
      for (const props of combos) for (const signedIn of [true, false]) {
        const r = core.checkEvent({ id: '6f1c0b8e-0000-4000-8000-000000000001', visit: 'v_abcd1234', t: CRON_NOW, name, props }, CRON_NOW, signedIn);
        if (!r.ok) continue;
        for (const a of core.dailyAdds(r.ev)) if (a.aggregate || !signedIn) aggKeys.add(a.metric + ':' + a.key);
      }
    }
    const counters = new Set(['linked', 'anon', 'refused', 'membership', 'erase'].map((k) => core.ceilingKey(k, CRON_DAY))).size;
    const extra = aggKeys.size * core.PLATFORMS.length + core.REFUSED.length + counters;
    if (!quiet) console.log('  a day expires beyond two caps: ' + aggKeys.size + ' aggregate keys x ' + core.PLATFORMS.length + ' platforms + ' + core.REFUSED.length + ' refusal reasons + ' + counters + ' counters = ' + extra);
    ok('what a day can expire beyond two caps (' + extra + ') is within RETENTION_DAY_EXTRA (' + core.RETENTION_DAY_EXTRA + '), and retention\'s reserve leaves erasure room', aggKeys.size >= 13 && extra <= core.RETENTION_DAY_EXTRA
      && wmod.__usage.retentionDayMax({ USAGE_DAILY_CAP: String(capToml) }) === 2 * capToml + core.RETENTION_DAY_EXTRA && wmod.__usage.retentionDayMax({ USAGE_DAILY_CAP: String(capToml) }) < allowance, { extra, keys: [...aggKeys] });

    /* ---- Steady state over many days at the cap, through the REAL cron (W4, PRIV-1, PRIV-6) ----
       Every simulated day: USAGE_DAILY_CAP events over the 24 hours before the tick (seven in ten in
       signed-in visits of five, one in ten anonymous, two in ten pregnancy-only screens inside signed-in
       visits), then the cron at 06:00 UTC of that day (and 06:15, 06:30, 06:45 if not finished). From
       Friday 1 May 2026 for 100 days. After every day's run nothing is past its window, every day is
       recorded as done, and the table stops growing once the oldest rows start to go. */
    if (opts.sim) {
      const dbs = fresh();
      const envs = { USAGE_DB: dbs, USAGE_DAILY_CAP: String(capToml) };
      const inss = dbs.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-05-01', 6, 'UTC', ?, 'd_sim000000001', ?, 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', ?)");
      const START = Date.UTC(2026, 4, 1, 6, 0, 0);
      const worst = { linked: 0, anon: 0, journey: 0 };
      const notDone = [], sizes = [];
      for (let d = 0; d < 100; d++) {
        const tick = START + d * DAY_MS;
        dbs.raw.exec('BEGIN');
        for (let i = 0; i < capToml; i++) {
          const v = Math.floor(i / 5), at = tick - DAY_MS + Math.floor(i * DAY_MS / capToml);
          const kind = v % 10 < 7 ? 'linked' : v % 10 < 8 ? 'anon' : 'journey';
          const uid = kind === 'anon' ? null : 'uidSim' + (v % 7);
          const props = kind === 'journey' && i % 5 > 1 ? '{"screen":"kicks"}' : '{"screen":"home"}';
          inss.run(uid || 'anon_d_sim000000001', 's' + d + '_' + i, at, at, uid, 'v_' + d + '_' + v, props);
        }
        dbs.raw.exec('COMMIT');
        const dayStr = new Date(tick).toISOString().slice(0, 10);
        for (let m = 0; m < 4; m++) {
          await atClock(tick + m * 15 * MIN_MS, () => w.scheduled({}, envs));
          if ((dbs.raw.prepare("SELECT value FROM usage_meta WHERE key = 'retention_day'").get() || {}).value === dayStr) break;
        }
        if ((dbs.raw.prepare("SELECT value FROM usage_meta WHERE key = 'retention_day'").get() || {}).value !== dayStr) notDone.push(dayStr);
        const c = core.retentionCutoffs(tick);
        // Any row past 90 days (signed in or not), and anonymous rows past 30: both read through an index.
        worst.linked = Math.max(worst.linked, dbs.raw.prepare('SELECT COUNT(*) AS c FROM usage_events INDEXED BY ue_at WHERE at < ?').get(c.events).c);
        worst.anon = Math.max(worst.anon, dbs.raw.prepare('SELECT COUNT(*) AS c FROM usage_events INDEXED BY ue_uid_at WHERE uid IS NULL AND at < ?').get(c.anon).c);
        // Pregnancy-only rows past 30 days have no index of their own, so that scan runs every tenth day and on the last.
        if (d % 10 === 9) worst.journey = Math.max(worst.journey, count(dbs, 'usage_events', "props LIKE '%kicks%' AND at < " + c.journey));
        if (d >= 91) sizes.push(count(dbs, 'usage_events'));
      }
      if (!quiet) console.log('  steady state: days 92 to 100 hold ' + Math.min(...sizes) + ' to ' + Math.max(...sizes) + ' rows');
      ok('steady state at the cap: after every day\'s run, nothing is past its window (S25)', worst.linked === 0 && worst.anon === 0 && worst.journey === 0, worst);
      ok('steady state at the cap: every day\'s run finishes that day', notDone.length === 0, notDone.slice(0, 5));
      ok('steady state at the cap: the table stops growing once rows start to expire', Math.max(...sizes) - Math.min(...sizes) <= capToml, sizes);

      /* ---- A shift in the mix (ERA-SK-2), through the REAL cron at the same cap ----
         Days 0 to 29: a cap of signed-in rows a day (visits of five, a head each). Days 60 to 119: a cap of
         anonymous rows a day. So on days 90 to 119 a day expires a cap of each, two caps in all, more than
         the old allowance of one and a half; with anonymous rows first, signed-in rows outlived 90 days for
         weeks. More than the shares let ingest store in a day, on purpose: whatever lands in the table, after
         every day's run nothing is past its window. Four ticks a day at most; from Friday 1 May 2026. */
      const dbm = fresh();
      const envm = { USAGE_DB: dbm, USAGE_DAILY_CAP: String(capToml) };
      const insm = dbm.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-05-01', 6, 'UTC', ?, 'd_sim000000001', ?, 'browser', 'macOS', 'Safari', 'v369', ?, ?)");
      const shift = { linked: 0, anon: 0, linkedDay: -1, anonDay: -1, dueBefore: 0 };
      for (let d = 0; d < 126; d++) {
        const tick = START + d * DAY_MS;
        if (d < 30 || (d >= 60 && d < 120)) {
          dbm.raw.exec('BEGIN');
          for (let i = 0; i < capToml; i++) {
            const at = tick - DAY_MS + Math.floor(i * DAY_MS / capToml), v = Math.floor(i / 5);
            if (d < 30) insm.run('uidSim' + (v % 7), 'm' + d + '_' + i, at, at, 'uidSim' + (v % 7), 'v_m' + d + '_' + v, i % 5 ? 'screen.viewed' : 'visit.started', i % 5 ? '{"screen":"home"}' : '{"opened_from":"icon","start":"cold"}');
            else insm.run('anon_d_sim000000001', 'm' + d + '_' + i, at, at, null, 'v_m' + d + '_' + v, 'screen.viewed', '{"screen":"signin"}');
          }
          dbm.raw.exec('COMMIT');
        }
        const dayStr = new Date(tick).toISOString().slice(0, 10);
        const c = core.retentionCutoffs(tick);
        // Staging, before the day's run: the rows past their window that this day's run must take.
        shift.dueBefore = Math.max(shift.dueBefore, count(dbm, 'usage_events', '(uid IS NOT NULL AND at < ' + c.events + ') OR (uid IS NULL AND at < ' + c.anon + ')'));
        for (let m = 0; m < 4; m++) {
          await atClock(tick + m * 15 * MIN_MS, () => w.scheduled({}, envm));
          if ((dbm.raw.prepare("SELECT value FROM usage_meta WHERE key = 'retention_day'").get() || {}).value === dayStr) break;
        }
        const l = dbm.raw.prepare('SELECT COUNT(*) AS c FROM usage_events INDEXED BY ue_at WHERE at < ? AND uid IS NOT NULL').get(c.events).c;
        const a = dbm.raw.prepare('SELECT COUNT(*) AS c FROM usage_events INDEXED BY ue_uid_at WHERE uid IS NULL AND at < ?').get(c.anon).c;
        if (l > shift.linked) { shift.linked = l; shift.linkedDay = d; }
        if (a > shift.anon) { shift.anon = a; shift.anonDay = d; }
      }
      ok('mix shift: no signed-in row outlives 90 days on any day', shift.linked === 0, shift);
      ok('mix shift: no anonymous row outlives 30 days on any day', shift.anon === 0, shift);
      ok('companion: the shift was staged: before some day\'s run, two caps of rows were past their window', shift.dueBefore >= 2 * capToml, shift);
    }
  } finally { console.error = realErr; console.log = realLog; }
  return { pass, fail, failed };
}

/* A temp directory holding the mutant worker.js and, recursively, every relative module it imports. A
   module that cannot be found throws here, loudly, rather than turning into a "caught" mutant. */
function mutantTree(src, overrides) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-erasure-mut-'));
  const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
  const place = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
    for (const m of text.matchAll(IMPORT)) {
      const dep = path.join(path.dirname(rel), m[1]);
      if (!fs.existsSync(path.join(dir, dep))) place(dep, fs.readFileSync(path.join(ROOT, dep), 'utf8'));
    }
  };
  // A mutated module (core.mjs) goes in first, so worker.js's import finds it instead of the repo's copy.
  for (const [rel, text] of Object.entries(overrides || {})) place(rel, text);
  place('worker.js', src);
  return dir;
}

(async () => {
  const real = path.join(ROOT, 'worker.js');
  if (!SELF) {
    console.log('\nusage-erasure\n');
    const r = await suite(real, false, { sim: true });
    console.log(r.pass + ' passed, ' + r.fail + ' failed');
    console.log('USAGE-ERASURE: ' + (r.fail ? 'FAIL' : 'PASS'));
    process.exit(r.fail ? 1 : 0);
  }
  /* Self-test: each break must turn the suite red. worker.js breaks run from a temp tree that carries every
     module worker.js imports (mutantTree), never from beside the real worker.js: a killed run must leave no
     broken worker in the repo, where a folder deploy would find it. A break marked `core` mutates
     workers/usage/core.mjs instead, in the same kind of temp tree (retention, the erasure steps, the
     counters' keys), and suite() imports core from that tree, so the worker and the checks run the mutant
     (ERA-SK-4). The other gates break the rest: test/usage-ingest.test.js --self-test (usage-ingest-mut)
     core.mjs's ingest rules, eraseHid's membership statement and refusal retention;
     test/usage-route.test.js --self-test the route and the membership cache, a purged person's marker included.
     What only a real Firestore and a counted subrequest budget can show (a stuck shell's cost, RE-SK-4) is
     test/feedback-purge-emulator.test.js. */
  const SRC = fs.readFileSync(real, 'utf8');
  const LINKED_ORDER = "'AND at < ?1 + ' + VISIT_SPAN_MS + \" ORDER BY at < ?1 DESC, name = 'visit.started' DESC, at LIMIT ?2)\"";
  const LINKED = "const LINKED_VISITS = 'DELETE FROM usage_events WHERE (who, id) IN (SELECT who, id FROM usage_events INDEXED BY ue_visit WHERE (uid, visit) IN '\n"
    + "  + '(SELECT uid, visit FROM usage_events INDEXED BY ue_at WHERE at < ?1 AND uid IS NOT NULL LIMIT ?2) '\n"
    + '  + ' + LINKED_ORDER + ';';
  const HID_HEADS_TARGET = "    ['usage_events', HEADS_OF_HID, eventsOf(HEADS_OF_HID)],\n";
  const HID_VISIT_TARGET = "    ['usage_events', VISITS_OF_HID + ' AND hid IS NOT ?1', eventsOf(VISITS_OF_HID + ' AND hid IS NOT ?1', CUT_ORDER)],\n";
  const HID_ROW_TARGET = "    ['usage_events', VISITS_OF_HID + ' AND +hid = ?1', eventsOf(VISITS_OF_HID + ' AND +hid = ?1', CUT_ORDER)],\n";
  const HID_BATCH = "  + WAY_BACK('w') + ' ORDER BY at LIMIT ' + (ERASE_CHUNK + 1) + ')';";
  const UID_EVENTS_TARGET = "    ['usage_events', 'uid = ?1', eventsOf(VISITS_OF_UID, CUT_ORDER)],\n";
  const RET_TAKES_FLOOR = '    if (unused > 0 && await usageTakeSlots(db, \'erase\', day, unused, floor, now)) maxRows += unused;\n';
  const SHELL_FIELDS = "            for (const k of PURGE_SHELL_FIELDS) if (d.fields && d.fields[k]) fields[k] = d.fields[k];\n"
    + '            fields.deleteAfter = { integerValue: String(now + PURGE_SHELL_RETRY_MS) };\n';
  const BREAKS = [
    ['the account purge skips usage', 'if (env.USAGE_DB) { try { await usageEraseUid(', 'if (false) { try { await usageEraseUid(', { must: /the purge leaves no .* row for the deleted person/ }],
    ['the account purge skips feedback', 'try { await deleteFeedbackOf(env, auth.uid); }', 'try { }', { must: /deletes the person's feedback notes/ }],
    ['the household purge skips usage', 'if (env.USAGE_DB) { try { await usageEraseHid(', 'if (false) { try { await usageEraseHid(', { must: /household purge alone/ }],
    ['the route trusts no token check', "try { uid = (await verifyFirebaseToken(m[1])).uid; } catch (e) { return json({ error: 'unauthorized' }, 401); }", "uid = 'x';", { must: /a bad token is a 401/ }],
    ['the cron skips usage maintenance', 'try { await usageMaintenance(env); }', 'try { }', { must: /the cron records its own day/ }],
    /* Erasure, retention and the sweep (W3-W6, F1, PRIV-1/2/6, ERA-SK-1/2/3, RE-SK-1/3/4, ERASE-CHUNK, SE-V1 to V5). Each
       names the check that must turn red, so a mutant caught by some unrelated failure does not count.
       `sim` also runs the long simulations (steady state and the mix shift). */
    ['the real Sunday sweep reads an Auth failure as nobody', "if (!r.ok) throw new Error('lookup_' + r.status);", '', { must: /Sunday sweep, Auth failing/ }],
    ['retention marks the day done before it drains', 'if (r.drained) marks.push(', 'if (true) marks.push(', { must: /carries on until nothing expired/ }],
    ['retention ignores its daily allowance', '  let maxRows = budget.dayMax - spent;', '  let maxRows = Infinity;', { must: /drains at the daily allowance/ }],
    ['retention never records its day', "if (r.drained) marks.push(put('retention_day', day));", '', { must: /recorded once the backlog is gone/ }],
    ['retention ignores the recorded day', 'if (meta.retention_day === day) return;', '', { must: /later ticks that day leave retention alone/ }],
    ['the daily allowance is below a day of expiry', 'usageCeilingsOf(env).cap * 9 / 4', 'usageCeilingsOf(env).cap * 2 / 4', { sim: true, must: /steady state at the cap/ }],
    ['the daily allowance is one and a half caps again (ERA-SK-2)', 'usageCeilingsOf(env).cap * 9 / 4', 'usageCeilingsOf(env).cap * 6 / 4', { sim: true, must: /mix shift: no anonymous row/ }],
    ['retention takes the whole allowance before the day\'s last tick, the erasures\' floor included (SE-V2)', '  let maxRows = budget.dayMax - spent;', '  let maxRows = budget.allowance - spent - (Number(meta[eraseKey]) || 0);', { must: /SE-V2/ }],
    ['retention takes the erasures\' floor by a figure it read earlier, not through their counter (SE-V3)', RET_TAKES_FLOOR, '    if (unused > 0) maxRows += unused;\n', { must: /SE-V3/ }],
    ['retention never takes what the erasures left of their floor, so a backlog drains slower', RET_TAKES_FLOOR, '', { must: /drains at the daily allowance/ }],
    ['the household purge writes no pending marker', 'try { await usageMarkHidErase(env.USAGE_DB, hid, now); }', 'try { }', { must: /next tick finishes it/ }],
    ['the cron never carries a pending erasure on', 'try { await usageErasePending(db, now, usageDeleteBudget(env), USAGE_ERASE_STEPS); }', 'try { }', { must: /next tick finishes it|across the ticks every row of hers goes/ }],
    ['a failed marker write keeps the whole household waiting (ERA-SK-1)', '          if (!marked) {\n', '          if (!marked) { continue; }\n          if (false) {\n', { must: /family's data is gone at once/ }],
    ['a family\'s shell waits for one write at the end of the tick (SK2-1)', '            if (shell) shells.push(cut);\n            else await purgeWriteShells(base, token, [cut]);\n', '            shells.push(cut);\n', { must: /SK2-1/ }],
    ['a failed marker write deletes the household outright (ERA-SK-1)', "            else await purgeWriteShells(base, token, [cut]);\n            continue;",
      '            else await purgeWriteShells(base, token, [cut]);', { must: /D1 answering, the purge deletes the shell and the usage rows|not due yet and stays/ }],
    ['the shell drops deleteAfter, so the purge never finds it again (ERA-SK-1)', SHELL_FIELDS, "            for (const k of PURGE_SHELL_FIELDS) if (k !== 'deleteAfter' && d.fields && d.fields[k]) fields[k] = d.fields[k];\n", { must: /D1 answering, the purge deletes the shell/ }],
    ['the shell keeps its old deleteAfter, so stuck shells stay first in the purge query (RE-SK-4)', SHELL_FIELDS, "            for (const k of PURGE_SHELL_FIELDS) if (d.fields && d.fields[k]) fields[k] = d.fields[k];\n", { must: /deleteAfter moves an hour on/ }],
    ['the shell changes only its own fields, leaving the family\'s (ERA-SK-1)', 'write: { update: { name: d.name, fields }, currentDocument:', 'write: { update: { name: d.name, fields }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument:', { must: /family's data is gone at once/ }],
    ['the account purge skips the hubs', 'try { hubs = await purgeHubsOf(env, auth.uid); }', 'try { }', { must: /every hub she owns/ }],
    ['retention runs one statement per class', 'if (gone < n) break;', 'break;', { core: true, must: /carries on until nothing expired/ }],
    ['retention splits a visit', LINKED, "const LINKED_VISITS = 'DELETE FROM usage_events WHERE (who, id) IN (SELECT who, id FROM usage_events INDEXED BY ue_at WHERE at < ?1 AND uid IS NOT NULL LIMIT ?2)';",
      { core: true, must: /dose visit split by the 90-day cutoff/ }],
    ['retention deletes a whole visit with no limit (the old statement)', LINKED, "const LINKED_VISITS = 'DELETE FROM usage_events WHERE (uid, visit) IN (SELECT uid, visit FROM usage_events INDEXED BY ue_at WHERE at < ?1 AND uid IS NOT NULL LIMIT ?2)';",
      { core: true, must: /never deletes more than the day's allowance/ }],
    ['retention deletes a visit oldest first, not head first', LINKED_ORDER, "'AND at < ?1 + ' + VISIT_SPAN_MS + \" ORDER BY at < ?1 DESC, at LIMIT ?2)\"", { core: true, must: /loses its head before/ }],
    ['retention takes every head of the pick first, young ones too (RE-SK-1)', LINKED_ORDER, "\"ORDER BY name = 'visit.started' DESC, at LIMIT ?2)\"", { core: true, must: /RE-SK-1/ }],
    ['retention takes a visit\'s young rows of any age with it (RE-SK-1)', LINKED_ORDER, "\" ORDER BY at < ?1 DESC, name = 'visit.started' DESC, at LIMIT ?2)\"", { core: true, must: /only what expired went|until they expire themselves/ }],
    ['retention runs the anonymous class first (ERA-SK-2)', "    ['events', LINKED_VISITS, c.events],\n",
      "    ['anon', 'DELETE FROM usage_events WHERE (who, id) IN (SELECT who, id FROM usage_events WHERE uid IS NULL AND at < ? LIMIT ?)', c.anon],\n    ['events', LINKED_VISITS, c.events],\n",
      { core: true, must: /person-linked rows go first/ }],
    ['retention keeps never-signed-in phones', "['devices', 'DELETE FROM devices WHERE rowid IN (SELECT rowid FROM devices WHERE uid IS NULL AND last_seen < ? LIMIT ?)', c.anon],", '', { core: true, must: /never-signed-in phone/ }],
    ['retention keeps day counters', "['meta', \"DELETE FROM usage_meta WHERE key IN (SELECT key FROM usage_meta WHERE key >= 'events_' AND key < ? LIMIT ?)\", 'events_' + c.refusedDay],", '', { core: true, must: /day ceiling counter/ }],
    ['the membership counter is keyed outside its day', "return 'events_' + day + CEILING_SUFFIX[kind];", "return kind === 'membership' ? 'members_' + day : 'events_' + day + CEILING_SUFFIX[kind];", { core: true, must: /membership ceiling's too/ }],
    ['retention\'s reserve is less than a day can expire (ERASE-CHUNK)', 'export const RETENTION_DAY_EXTRA = 100;', 'export const RETENTION_DAY_EXTRA = 50;', { core: true, must: /within RETENTION_DAY_EXTRA/ }],
    ['an erasure step has no row bound (ERASE-CHUNK)', 'export const ERASE_CHUNK = 1000;', 'export const ERASE_CHUNK = 1e9;', { core: true, must: /every step deletes at most|steps of at most/ }],
    ['an erasure takes no share of the daily allowance (ERASE-CHUNK)', '  const cap = Math.max(0, budget.allowance - reserved);', '  const cap = 1e12;', { core: true, must: /no UTC day deletes more than the shared delete allowance/ }],
    ['an erasure ignores retention\'s reserve (ERASE-CHUNK)', '  const reserved = state.rday === day ? ret : Math.max(ret, budget.dayMax);', '  const reserved = ret;', { core: true, must: /first step takes only what lies beyond/ }],
    ['the account purge puts an unfinished erasure on no record (ERASE-CHUNK)', "  return eraseStep(db, 'uid', uid, now, budget, { mark: true });", "  return eraseStep(db, 'uid', uid, now, budget, { mark: false });", { core: true, must: /puts it on record/ }],
    ['a household\'s own rows go before the rows that only share its visits (ERASE-CHUNK)', HID_VISIT_TARGET + HID_ROW_TARGET, HID_ROW_TARGET + HID_VISIT_TARGET, { core: true, must: /the rows carrying the new family too/ }],
    ['eraseHid splits a visit', HID_VISIT_TARGET, '', { core: true, must: /every row of a visit that carried it/ }],
    ['a household\'s erasure does not take its visits\' heads first (SE-V1)', HID_HEADS_TARGET, '', { core: true, must: /SE-V1/ }],
    ['a household\'s erasure takes the rows of its visits in no order (SE-V1)', HID_VISIT_TARGET, HID_VISIT_TARGET.replace(", CUT_ORDER)", ")"), { core: true, must: /SE-V1/ }],
    ['a household\'s erasure lists every visit it has again, not a batch of them (SK2-2)', HID_BATCH, "  + WAY_BACK('w') + ')';", { core: true, hh: true, must: /SK2-2/ }],
    ['a household\'s batch counts every head too, so taking them moves it (SK2-2)', HID_BATCH, "  + '1' + ' ORDER BY at LIMIT ' + (ERASE_CHUNK + 1) + ')';", { core: true, hh: true, must: /SK2-2|SE-V1/ }],
    ['a household takes a head that is its visit\'s way back before the visit\'s other rows (SK2-2)', "' AND (hid IS NOT ?1 OR NOT ' + WAY_BACK('e') + ')'", "''", { core: true, hh: true, must: /SK2-2|the rows carrying the new family too/ }],
    ['a row carrying the household with no uid is never erased (SK2-2)', "    ['usage_events', STRAYS_OF_HID, eventsOf(STRAYS_OF_HID)],\n", '', { core: true, hh: true, must: /SK2-2/ }],
    ['a person\'s erasure takes her events in no order (SE-V1)', UID_EVENTS_TARGET, UID_EVENTS_TARGET.replace(", CUT_ORDER)", ")"), { core: true, must: /SE-V1/ }],
    ['the marker clears before the step\'s rows go (ERASE-CHUNK)', "  if (done && kind === 'hid') stmts.push(db.prepare(CLEAR.hid).bind(id, marker));", "  if (done && kind === 'hid') await db.prepare('DELETE FROM usage_meta WHERE key = ?').bind(marker).run();", { core: true, must: /failure left a pending erasure on record/ }],
    ['eraseHid leaves its pending marker', "  if (done && kind === 'hid') stmts.push(db.prepare(CLEAR.hid).bind(id, marker));", "  if (done && kind === 'hid') stmts.push(db.prepare('SELECT 1').bind());", { core: true, must: /leaves no pending erasure|clears the marker/ }],
    ['the account purge marks her only when rows are left over (SE-V5)', '    await mark(done ? now + ERASE_HOLD_MS : now);', '    if (!done) await mark(now);', { core: true, must: /SE-V5/ }],
    ['a step that finishes her erasure holds her marker though a row of hers is left (SE-V5)', "WHERE key = ?2 AND CAST(value AS INTEGER) > ?3' + NONE_LEFT('uid');", "WHERE key = ?2 AND CAST(value AS INTEGER) > ?3';", { core: true, must: /go on the next tick, not when/ }],
    ['a person\'s marker is not held for the membership memory\'s life (RE-SK-3)', 'export const ERASE_HOLD_MS = MEMBERSHIP_TTL_MS;', 'export const ERASE_HOLD_MS = 0;', { core: true, must: /marker is held/ }],
    ['a tick with no room still runs every due erasure\'s count (SK2-2)', '    if (left <= 2) break;\n', '', { core: true, must: /SK2-2/ }],
    ['a person\'s erasure sorts every row she has again, not a batch of her visits (SK2-2)', UID_EVENTS_TARGET, "    ['usage_events', 'uid = ?1', eventsOf('uid = ?1', CUT_ORDER)],\n", { core: true, must: /SK2-2/ }],
    ['a person\'s erasure looks her rows up by who again (SK2-2)', UID_EVENTS_TARGET, UID_EVENTS_TARGET + "    ['usage_events', 'who = ?1 AND uid IS NOT ?1', eventsOf('who = ?1 AND uid IS NOT ?1', CUT_ORDER)],\n", { core: true, must: /SK2-2/ }],
    ['a failed step keeps its place at the front of the queue (SE-V4)', "      try { await db.prepare('UPDATE usage_meta SET at = ? WHERE key = ?').bind(now, r.key).run(); }", '      try { }', { core: true, must: /SE-V4/ }],
  ];
  const CORE = fs.readFileSync(path.join(ROOT, 'workers', 'usage', 'core.mjs'), 'utf8');
  let caught = 0;
  /* Paired: an unaltered worker.js run from the same kind of temp tree must pass every check, so each red
     below is its break's, not the copy's. */
  const same = mutantTree(SRC);
  let clean;
  try { clean = await suite(path.join(same, 'worker.js'), true); } finally { fs.rmSync(same, { recursive: true, force: true }); }
  if (clean.fail === 0) console.log('  ok   an unaltered copy in a temp tree passes (' + clean.pass + ' checks)');
  else console.log('  FAIL an unaltered copy in a temp tree fails ' + clean.fail + ' check(s)');
  for (const [name, find, repl, o] of BREAKS) {
    const opt = o || {};
    if (!(opt.core ? CORE : SRC).includes(find)) { console.log('  FAIL anchor missing for: ' + name); continue; }
    const dir = opt.core ? mutantTree(SRC, { 'workers/usage/core.mjs': CORE.replace(find, repl) }) : mutantTree(SRC.replace(find, repl));
    try {
      const r = await suite(path.join(dir, 'worker.js'), true, { sim: !!opt.sim, hh: !!opt.hh });
      if (opt.must ? r.failed.some((n) => opt.must.test(n)) : r.fail > 0) caught++;
      else console.log('  FAIL not caught: ' + name + (r.fail ? ' (red, but not at ' + opt.must + ': ' + r.failed.join('; ').slice(0, 300) + ')' : ''));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  console.log('self-test: ' + caught + ' of ' + BREAKS.length + ' breaks caught');
  const good = caught === BREAKS.length && clean.fail === 0;
  console.log('USAGE-ERASURE SELF-TEST: ' + (good ? 'PASS' : 'FAIL'));
  process.exit(good ? 0 : 1);
})().catch((e) => { console.error('threw:', e && e.stack || e); process.exit(1); });
