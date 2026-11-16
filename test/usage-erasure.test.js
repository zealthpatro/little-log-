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
const J = (o, s, h) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'content-type': 'application/json' }, h || {}) });
globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const method = ((init && init.method) || 'GET').toUpperCase();
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
      return J(dueHouseholds.filter((h) => docs.has('households/' + h)).map((h) => ({ document: { name: 'projects/' + PROJECT + '/databases/(default)/documents/households/' + h,
        fields: { deleteAfter: { integerValue: '1' }, ownerId: { stringValue: 'uidGone' }, members: { mapValue: {} } }, updateTime: '2026-11-01T00:00:00Z' } })));
    }
    if (!want) return J([]);
    return J([...docs.entries()].filter(([p, f]) => p.startsWith(coll + '/') && f.uid && f.uid.stringValue === want).map(([p]) => ({ document: { name: 'projects/' + PROJECT + '/databases/(default)/documents/' + p } })));
  }
  if (url === FS + ':commit' && method === 'POST') {
    const writes = JSON.parse(init.body).writes || [];
    commits.push(writes.length);
    for (const wr of writes) {
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

/* `opts.sim`: also run the long steady-state simulation (about two seconds). The plain run and the
   self-test's control and its allowance mutant do; the other mutants are caught by the short checks. */
async function suite(workerFile, quiet, opts) {
  opts = opts || {};
  let pass = 0, fail = 0;
  const failed = [];
  const ok = (n, c, x) => { if (c) pass++; else { fail++; failed.push(n); if (!quiet) console.log('  FAIL ' + n + (x !== undefined ? '\n       ' + JSON.stringify(x).slice(0, 400) : '')); } };
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

    // ---- The weekly orphan sweep ----
    const db4 = fresh();
    for (const u of [ME, OTHER]) db4.raw.prepare("INSERT INTO usage_daily VALUES ('2026-11-15', ?, 'h', 'browser', 'visits', '', 1)").run(u);
    authFails = true; authKnown = new Set([ME]);
    let threw = false;
    try { await core.orphanSweep(db4, async (uids) => { const r = await fetch(AUTH, { method: 'POST', body: JSON.stringify({ localId: uids }) }); if (!r.ok) throw new Error('lookup'); return { known: new Set(((await r.json()).users || []).map((x) => x.localId)) }; }); } catch (e) { threw = true; }
    ok('when Auth fails to answer, the sweep stops and deletes nobody', threw && count(db4, 'usage_daily') === 2);
    authFails = false;
    await core.orphanSweep(db4, async (uids) => { const r = await fetch(AUTH, { method: 'POST', body: JSON.stringify({ localId: uids }) }); return { known: new Set(((await r.json()).users || []).map((x) => x.localId)) }; });
    ok('when Auth answers, a uid it no longer has is erased', count(db4, 'usage_daily', "uid = '" + OTHER + "'") === 0);
    ok('companion: and a uid it still has is kept', count(db4, 'usage_daily', "uid = '" + ME + "'") === 1);

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
    for (const k of ['events_2026-08-01', 'events_2026-11-15', 'sweep_day']) db7.raw.prepare('INSERT INTO usage_meta (key, value, at) VALUES (?, ?, 1)').run(k, '5');
    await core.runRetention(db7, CRON_NOW);
    const devs7 = db7.raw.prepare('SELECT device FROM devices ORDER BY device').all().map((x) => x.device).join();
    ok('a never-signed-in phone\'s device row goes 30 days after it was last seen', !devs7.includes('d_anonold00001'), devs7);
    ok('companion: one seen 29 days ago stays', devs7.includes('d_anonnew00001'), devs7);
    ok('companion: a signed-in device row stays until its account goes', devs7.includes('d_linkedold001'), devs7);
    const keys7 = db7.raw.prepare('SELECT key FROM usage_meta ORDER BY key').all().map((x) => x.key).join();
    ok('a day ceiling counter older than 90 days goes; a recent one and the cron markers stay', keys7 === 'events_2026-11-15,sweep_day', keys7);

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

    /* ---- Retention's daily delete allowance: a backlog drains over days, not in one (W4) ----
       Cap 1,000 gives an allowance of 1,500 rows a UTC day. 4,000 expired rows: 1,500, 1,500, then 1,000. */
    const db8b = fresh();
    const ins8b = db8b.raw.prepare("INSERT INTO usage_events (who,id,at,client_at,local_day,local_hour,tz,uid,device,visit,platform,os,browser,app_version,name,props) VALUES (?, ?, ?, ?, '2026-08-17', 6, 'UTC', NULL, 'd_k3j9x2m7q1aa', ?, 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{\"screen\":\"signin\"}')");
    db8b.raw.exec('BEGIN'); for (let i = 0; i < 4000; i++) ins8b.run('anon_d_k3j9x2m7q1aa', 'anon' + i, CUT - i, CUT - i, 'v_a' + i); db8b.raw.exec('COMMIT');
    const env8b = { USAGE_DB: db8b, USAGE_DAILY_CAP: '1000' };
    const gone8b = [];
    let was = count(db8b, 'usage_events');
    for (const [d, m] of [[0, 0], [0, 15], [1, 0], [1, 15], [2, 0]]) {   // 16, 17 and 18 November 2026, 06:00 and 06:15 UTC
      await atClock(CRON_NOW + d * DAY_MS + m * MIN_MS, () => w.scheduled({}, env8b));
      const now8 = count(db8b, 'usage_events'); gone8b.push(was - now8); was = now8;
    }
    ok('a backlog drains at the daily allowance: 1,500 a day, the second tick of a day deletes nothing', gone8b.join() === '1500,0,1500,0,1000', gone8b);
    ok('and the day is recorded once the backlog is gone (pinned: 18 November 2026)', (db8b.raw.prepare("SELECT value FROM usage_meta WHERE key = 'retention_day'").get() || {}).value === '2026-11-18');

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

    /* ---- If even the marker cannot be written, the document waits for the next tick ---- */
    const db9b = hooked();
    seedHh(db9b, 'hhGone03');
    docs.set('households/hhGone03', { deleteAfter: { integerValue: '1' } }); dueHouseholds = ['hhGone03'];
    failSql = /^INSERT INTO usage_meta/; failLeft = 1; failKey = 'erase_hid:';
    const errAt9b = errs.length;
    const env9b = { USAGE_DB: db9b, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
    await atCronClock(() => w.scheduled({}, env9b));
    ok('when the marker cannot be written, the household document stays for the next tick', docs.has('households/hhGone03') && failLeft === 0, { doc: docs.has('households/hhGone03'), failLeft });
    ok('and that is logged by code', errs.slice(errAt9b).some((e) => /purge_usage_mark_fail/.test(e)), errs.slice(errAt9b));
    await atClock(CRON_NOW + 15 * MIN_MS, () => w.scheduled({}, env9b));
    dueHouseholds = []; failSql = null; failKey = null;
    ok('the next tick deletes it and its usage rows, and clears the marker', !docs.has('households/hhGone03') && hhLeft(db9b, 'hhGone03') === 0 && pending(db9b) === 0, { doc: docs.has('households/hhGone03'), left: hhLeft(db9b, 'hhGone03'), pending: pending(db9b) });

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

    /* ---- The D1 write arithmetic behind USAGE_DAILY_CAP (W4), from the REAL schema and wrangler.toml ----
       D1 bills one written row per row, plus one per index the write touches (deletes too). Worst case per
       event: a batch of one that also starts a new daily row. Under half the 100,000 a day the account
       shares, with 3,000 left for membership refreshes and the cron's own markers. */
    const capToml = Number((/^USAGE_DAILY_CAP\s*=\s*"(\d+)"/m.exec(fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8')) || [])[1]);
    const sm = fresh().raw;
    const idxOf = (t, auto) => sm.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND tbl_name = ?" + (auto ? '' : " AND name NOT LIKE 'sqlite_autoindex%'")).get(t).c;
    const perInsert = 1 /* day counter update */ + (1 + idxOf('usage_events', true)) + (1 + idxOf('usage_daily', true)) + (1 + idxOf('devices', false)) /* device update: uid is in its SET list */;
    const perDelete = Math.max(...['usage_events', 'usage_daily', 'usage_refused', 'devices', 'usage_meta'].map((t) => 1 + idxOf(t, true)));
    const allowanceOf = wmod.__usage && wmod.__usage.retentionDailyRows;
    const allowance = allowanceOf ? allowanceOf({ USAGE_DAILY_CAP: String(capToml) }) : NaN;
    const steady = capToml * (perInsert + perDelete), catchup = capToml * perInsert + allowance * perDelete;
    if (!quiet) console.log('  write arithmetic: cap ' + capToml + ', ' + perInsert + ' to store an event, ' + perDelete + ' to delete one, allowance ' + allowance + ' rows a day; steady ' + steady + ', catch-up day ' + catchup);
    ok('at USAGE_DAILY_CAP, storing and later deleting a day of events stays under half the D1 allowance, with 3,000 to spare', capToml > 0 && steady <= 47000, { capToml, perInsert, perDelete, steady });
    ok('and so does a catch-up day that deletes the whole daily retention allowance', catchup <= 47000, { catchup, allowance });
    ok('the retention allowance is more than a day of expiry at the cap, so a backlog drains', allowance > capToml, { allowance, capToml });

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
     broken worker in the repo, where a folder deploy would find it. test/usage-ingest.test.js --self-test (gate
     usage-ingest-mut) breaks core.mjs's ingest rules, eraseHid's membership statement and refusal retention;
     test/usage-route.test.js --self-test breaks the route. */
  const SRC = fs.readFileSync(real, 'utf8');
  const BREAKS = [
    ['the account purge skips usage', 'if (env.USAGE_DB) { try { await usageEraseUid(env.USAGE_DB, auth.uid); }', 'if (false) { try { await usageEraseUid(env.USAGE_DB, auth.uid); }'],
    ['the account purge skips feedback', 'try { await deleteFeedbackOf(env, auth.uid); }', 'try { }'],
    ['the household purge skips usage', 'if (env.USAGE_DB) { try { await usageEraseHid(env.USAGE_DB, hid); }', 'if (false) { try { await usageEraseHid(env.USAGE_DB, hid); }', { must: /household purge alone/ }],
    ['the route trusts no token check', "try { uid = (await verifyFirebaseToken(m[1])).uid; } catch (e) { return json({ error: 'unauthorized' }, 401); }", "uid = 'x';"],
    ['the cron skips usage maintenance', 'try { await usageMaintenance(env); }', 'try { }'],
    /* Erasure, retention and the sweep (W3-W6, F1, PRIV-1/2/6). Each names the check that must turn red,
       so a mutant caught by some unrelated failure does not count. `core` breaks workers/usage/core.mjs in
       the temp tree instead of worker.js; `sim` also runs the long steady-state simulation. */
    ['the real Sunday sweep reads an Auth failure as nobody', "if (!r.ok) throw new Error('lookup_' + r.status);", '', { must: /Sunday sweep, Auth failing/ }],
    ['retention marks the day done before it drains', 'if (r.drained) marks.push(', 'if (true) marks.push(', { must: /carries on until nothing expired/ }],
    ['retention ignores its daily allowance', 'maxRows: allowance', 'maxRows: Infinity', { must: /drains at the daily allowance/ }],
    ['retention never records its day', "if (r.drained) marks.push(put('retention_day', day));", '', { must: /recorded once the backlog is gone/ }],
    ['retention ignores the recorded day', 'if (meta.retention_day === day) return;', '', { must: /later ticks that day leave retention alone/ }],
    ['the daily allowance is below a day of expiry', 'Math.floor(cap * 1.5)', 'Math.floor(cap * 0.5)', { sim: true, must: /steady state at the cap/ }],
    ['the household purge writes no pending marker', 'try { await usageMarkHidErase(env.USAGE_DB, hid, now); }', 'try { }', { must: /next tick finishes it/ }],
    ['the cron never retries a pending household', 'try { await usageErasePendingHids(db, 5); }', 'try { }', { must: /next tick finishes it/ }],
    ['a failed marker write still deletes the household', "catch (e) { console.error('purge_usage_mark_fail'); continue; }", "catch (e) { console.error('purge_usage_mark_fail'); }", { must: /document stays for the next tick/ }],
    ['the account purge skips the hubs', 'try { hubs = await purgeHubsOf(env, auth.uid); }', 'try { }', { must: /every hub she owns/ }],
    ['retention runs one statement per class', 'if (gone < n) break;', 'break;', { core: true, must: /carries on until nothing expired/ }],
    ['retention splits a visit', 'DELETE FROM usage_events WHERE (uid, visit) IN (SELECT uid, visit FROM usage_events INDEXED BY ue_at WHERE at < ? AND uid IS NOT NULL LIMIT ?)',
      'DELETE FROM usage_events WHERE (who, id) IN (SELECT who, id FROM usage_events INDEXED BY ue_at WHERE at < ? AND uid IS NOT NULL LIMIT ?)', { core: true, must: /dose visit split by the 90-day cutoff/ }],
    ['retention keeps never-signed-in phones', "['devices', 'DELETE FROM devices WHERE rowid IN (SELECT rowid FROM devices WHERE uid IS NULL AND last_seen < ? LIMIT ?)', c.anon],", '', { core: true, must: /never-signed-in phone/ }],
    ['retention keeps day counters', "['meta', \"DELETE FROM usage_meta WHERE key IN (SELECT key FROM usage_meta WHERE key >= 'events_' AND key < ? LIMIT ?)\", 'events_' + c.refusedDay],", '', { core: true, must: /day ceiling counter/ }],
    ['eraseHid leaves its pending marker', "db.prepare('DELETE FROM usage_meta WHERE key = ?').bind(PENDING_HID + hid),", "db.prepare('SELECT 1').bind(),", { core: true, must: /leaves no pending erasure|clears the marker/ }],
    ['eraseHid splits a visit', "db.prepare('DELETE FROM usage_events WHERE (uid, visit) IN (SELECT uid, visit FROM usage_events WHERE hid = ? AND uid IS NOT NULL)').bind(hid),", '', { core: true, must: /every row of a visit that carried it/ }],
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
      const r = await suite(path.join(dir, 'worker.js'), true, { sim: !!opt.sim });
      if (opt.must ? r.failed.some((n) => opt.must.test(n)) : r.fail > 0) caught++;
      else console.log('  FAIL not caught: ' + name + (r.fail ? ' (red, but not at ' + opt.must + ': ' + r.failed.join('; ').slice(0, 300) + ')' : ''));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  console.log('self-test: ' + caught + ' of ' + BREAKS.length + ' breaks caught');
  const good = caught === BREAKS.length && clean.fail === 0;
  console.log('USAGE-ERASURE SELF-TEST: ' + (good ? 'PASS' : 'FAIL'));
  process.exit(good ? 0 : 1);
})().catch((e) => { console.error('threw:', e && e.stack || e); process.exit(1); });
