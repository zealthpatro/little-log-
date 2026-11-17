/* usage-d1: the usage events' SQL on the REAL D1 engine, not only on the shim.
 *
 *   node test/usage-d1-engine.test.js               the checks on both engines, then the usage suites on D1
 *   node test/usage-d1-engine.test.js --self-test   also: every D1-only break must turn the checks red ON D1
 *                                                   while the same checks stay green on the shim
 *
 * Every other usage test runs on node:sqlite through the D1 shim (workers/admin/dev/d1-sqlite.mjs). D1 is
 * SQLite too, but not that SQLite: it refuses BEGIN and SAVEPOINT, a bound `undefined`, more than 100 bound
 * parameters, a compound SELECT of more than 5 terms and a LIKE pattern over 50 bytes, runs its own build, and
 * bills rows written per index entry. Here workerd's own D1 runs locally and offline through Miniflare
 * (workers/admin/dev/d1-miniflare.mjs; the pinned version there, found in tools/node_modules or npx's cache,
 * or at MINIFLARE_PATH, which is held to the same pin; never skipped: no Miniflare is a failure).
 *
 *   0. The harness: MINIFLARE_PATH at another build is refused, and a run on any build but the pinned one
 *      cannot pass; Miniflare's thread opens no socket beyond loopback: it refuses any before DNS and records
 *      it, and a record fails this run (checked here, in each suite of section 4, and in the probes); and a
 *      process holding a D1 that is sent SIGTERM, SIGINT, SIGHUP or SIGALRM (nightly.sh's watchdog) alone takes
 *      its workerd with it.
 *   1. Engine facts the code relies on or must avoid, asserted on D1: the schema applies statement by
 *      statement and builds what the shim builds; usage_events stays WITHOUT ROWID; no trigger (D1 counts a
 *      trigger's rows in meta.changes, node:sqlite does not); BEGIN, SAVEPOINT, `undefined`, 101 parameters,
 *      a 6-term compound SELECT and a 51-byte LIKE pattern refused (the shim takes the last three); no usage
 *      statement opens a transaction; first() is all()'s first row.
 *   2. The REAL code paths on both engines, every answer and every table compared: core.mjs ingest (retries,
 *      a membership with no household, anonymous, journey totals, the ceilings, refusals); runRetention in
 *      chunks until drained; eraseUid and eraseHid in steps, resumed by erasePending over several UTC days;
 *      an erase step whose batch fails INSIDE D1 (a staged RAISE) changes nothing; orphanSweep over 150
 *      people; worker.js usageMembership (its LEFT JOIN read, its upsert, its backfill); every read in
 *      workers/admin/src/usage.mjs on the sample families, and at SCOPE_MAX uids (100 parameters exactly).
 *   3. D1's own meter (meta.rows_written) against the write arithmetic beside USAGE_DAILY_CAP in
 *      wrangler.toml: each term measured, and the worst UTC day recomputed from the measurements.
 *   4. usage-ingest, usage-route, usage-erasure and admin-screens, unchanged, with every makeD1() on D1
 *      (CUBBY_D1_ENGINE=miniflare) and every statement shadowed on node:sqlite: each must pass with the same
 *      count as on the shim, and no statement may answer differently.
 *   --self-test adds the breaks below, and runs the harness of a copy started without `cf: false`, which
 *      must be caught reaching for workers.cloudflare.com (and refused before DNS), and of a copy without its
 *      signal handlers, whose workerd must be caught left behind after a SIGTERM.
 * Clock-pinned: Monday 16 November 2026 06:00 UTC (the day AND the hour), and the UTC days after it.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const nodeCrypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const SELF = process.argv.includes('--self-test');
const PROBE = process.argv[2] === '--probe' ? process.argv[3] : null;   // a child of the self-test: see probe()
const HOLD = process.argv[2] === '--hold' ? process.argv[3] : null;     // a child of section 0: see hold()
const HOLD_PARENT = process.argv[2] === '--hold-parent' ? process.argv.slice(3, 5) : null;   // ...and its parent: see holdParent()
const SUITES_OFF = process.argv.includes('--checks-only');
delete process.env.CUBBY_D1_ENGINE;   // this process picks its engine per check; d1-sqlite.mjs must stay the shim here
let importN = 0;
const imp = (root, rel, fresh) => import(pathToFileURL(path.join(root, rel)).href + (fresh ? '?n=' + (++importN) : ''));

const T0 = Date.UTC(2026, 10, 16, 6, 0, 0);       // Monday 16 November 2026, 06:00 UTC
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
const PROJECT = 'little-log-a9caa';
const FSB = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const SA = JSON.stringify({ project_id: PROJECT, client_email: 'cubby@' + PROJECT + '.iam.gserviceaccount.com',
  private_key: nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey });

/* The world outside: Google's token endpoint and Firestore documents, for usageMembership. */
const docs = new Map();
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const method = ((init && init.method) || 'GET').toUpperCase();
  if (url.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 'tok', expires_in: 3600 });
  if (url.startsWith(FSB + '/') && method === 'GET') {
    const p = decodeURIComponent(url.slice(FSB.length + 1).split('?')[0]);
    return docs.has(p) ? J({ name: FSB + '/' + p, fields: docs.get(p) }) : J({ error: { status: 'NOT_FOUND' } }, 404);
  }
  throw new Error('unstubbed external call: ' + method + ' ' + url);
};
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

/* ---------- ports: inside the band this session was given ---------- */
function portIsFree(port) {
  return new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(port, '127.0.0.1', () => s.close(() => res(true))); });
}
async function pickPorts(k) {
  const out = [];
  for (const n of ['FS_PORT', 'AUTH_PORT', 'WEB_PORT', 'STATIC_PORT', 'HUB_PORT', 'LOG_PORT', 'WS_PORT']) {
    const p = Number(process.env[n]);
    if (p > 0 && out.length < k && !out.includes(p) && await portIsFree(p)) out.push(p);
  }
  const band = /^(\d+)-(\d+)$/.exec(process.env.EMU_PORT_RANGE || '');
  if (band) for (let p = Number(band[1]); p <= Number(band[2]) && out.length < k; p++) if (!out.includes(p) && await portIsFree(p)) out.push(p);
  if (band && out.length < k) throw new Error('EMU_PORT_RANGE ' + band[0] + ' has no ' + k + ' free ports');
  while (out.length < k) out.push(0);   // no band given: the OS picks a free one
  return out;
}

/* ---------- the checks, on one engine ---------- */

const stable = (v) => JSON.stringify(v, (k, x) => (x instanceof Map ? [...x.entries()] : x instanceof Set ? [...x] : x));
const FILLER = (i) => 'uidFiller' + String(i).padStart(19, '0');

async function scenario(root, kind, eng, quiet) {
  let pass = 0, fail = 0;
  const failed = [];
  const trace = new Map();
  const facts = {};
  const ok = (n, c, x) => { if (c) pass++; else { fail++; failed.push(n); if (!quiet) console.log('  FAIL [' + kind + '] ' + n + (x !== undefined ? '\n         ' + stable(x).slice(0, 500) : '')); } };
  const rec = (label, v) => { trace.set(label, stable(v)); };
  /* A section that throws is a failure, never the end of the run: the self-test's breaks make D1 refuse. */
  const section = async (name, fn) => { try { await fn(); } catch (e) { ok(name + ': ran to its end (it threw ' + String((e && e.message) || e).slice(0, 160) + ')', false); } };
  const D1 = kind === 'd1';
  const core = await imp(root, 'workers/usage/core.mjs');
  const usage = await imp(root, 'workers/admin/src/usage.mjs');
  const schema = fs.readFileSync(path.join(root, 'schema', 'usage.sql'), 'utf8');
  const mk = (o) => eng.make(kind, o);
  const fresh = (o) => { const d = mk(o); d.raw.exec(schema); return d; };
  const rows = (d, sql, ...a) => d.raw.prepare(sql).all(...a);
  const one = (d, sql, ...a) => d.raw.prepare(sql).get(...a) || {};
  const count = (d, t, where) => one(d, 'SELECT COUNT(*) AS c FROM ' + t + (where ? ' WHERE ' + where : '')).c;
  const dumpOf = (d) => d.dump();
  const throwsOn = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message || e); } };
  const ingestCtx = (d, o) => Object.assign({ db: d, uid: null, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15', now: T0, notice: '',
    env: { USAGE_MODE: 'internal', INTERNAL_UIDS: 'uidMe0000000000000000000001', USAGE_DAILY_CAP: '100000' }, membership: async () => ({ hid: 'hhA0000001', role: 'owner', notice: '' }), log: () => {} }, o || {});
  let idn = 0;
  const ev = (name, props, o) => Object.assign({ id: '6f1c0b8e-0000-4000-8000-' + (++idn).toString(16).padStart(12, '0'), t: T0 - 60000, visit: 'v_d1test01', name, props }, o || {});
  const body = (events, o) => Object.assign({ v: 1, tz: 'Asia/Dubai', device: 'd_d1engine0001', platform: 'ios_app', app_version: 'v370', events }, o || {});
  const ME = 'uidMe0000000000000000000001';

  /* ---- 1. engine facts ---- */
  await section('engine facts', async () => {
    const d = fresh();
    const objs = (x) => rows(x, 'SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name')
      .filter((r) => !/^(sqlite_|_cf_)/.test(r.name)).map((r) => [r.type, r.name, r.tbl_name, String(r.sql || '').replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim()]);
    const mine = objs(d);
    rec('schema objects', mine);
    /* On D1 the file goes in statement by statement (D1 refuses BEGIN, and its exec() splits on newlines), on
       the shim in one exec(); the two lists of objects are compared below with every other answer. */
    ok('the schema applies (' + mine.filter((o) => o[0] === 'table').length + ' tables, ' + mine.filter((o) => o[0] === 'index').length + ' indexes)',
      mine.some((o) => o[1] === 'usage_events') && mine.some((o) => o[1] === 'ue_visit') && mine.some((o) => o[1] === 'usage_meta'), mine.map((o) => o[0] + ' ' + o[1]));
    const sqlOf = (t) => (mine.find((o) => o[1] === t) || [])[3] || '';
    ok('usage_events is WITHOUT ROWID', /WITHOUT ROWID\s*$/i.test(sqlOf('usage_events')), sqlOf('usage_events'));
    const noRowid = await throwsOn(() => d.prepare('SELECT rowid FROM usage_events LIMIT 1').all());
    ok('so it has no rowid to select', !!noRowid && /rowid/i.test(noRowid), noRowid);
    ok('companion: a rowid table answers the same select', !(await throwsOn(() => d.prepare('SELECT rowid FROM usage_daily LIMIT 1').all())));
    ok('the schema holds no trigger (so meta.changes counts only the statement\'s own rows)', count(d, 'sqlite_master', "type = 'trigger'") === 0);
    if (D1) {
      /* What D1 does differently from the shim, each the reason for a rule above or in the code. */
      const t = fresh();
      t.raw.exec("CREATE TABLE _w (n INTEGER); INSERT INTO _w VALUES (0); CREATE TRIGGER _w_u AFTER UPDATE ON usage_meta BEGIN UPDATE _w SET n = n + 1; END");
      t.raw.prepare("INSERT INTO usage_meta (key, value, at) VALUES ('k', '1', 1)").run();
      const ch = (await t.prepare("UPDATE usage_meta SET value = '2' WHERE key = 'k'").run()).meta.changes;
      facts.triggerChanges = ch;
      ok('D1 fact: an update of one row under a trigger reports ' + ch + ' changes (the trigger\'s row too; node:sqlite says 1)', ch === 2, ch);
      const begin = await throwsOn(() => t.prepare('BEGIN').run());
      ok('D1 fact: BEGIN is refused (a step\'s atomicity can only come from batch())', !!begin && /transaction/i.test(begin), begin);
      const undef = await throwsOn(() => t.prepare('SELECT ? AS a').bind(undefined).all());
      ok('D1 fact: a bound undefined is refused (the shim stores NULL)', !!undef && /undefined/.test(undef), undef);
      const many = (k) => t.prepare('SELECT 1 AS y WHERE 0 IN (' + Array.from({ length: k }, () => '?').join(', ') + ')').bind(...Array.from({ length: k }, (x, i) => i + 1)).all();
      const at101 = await throwsOn(() => many(101));
      ok('D1 fact: 101 bound parameters are refused', !!at101 && /too many SQL variables/i.test(at101), at101);
      ok('D1 fact: and 100 are taken (usage.mjs D1_MAX_BOUND)', !(await throwsOn(() => many(100))) && usage.D1_MAX_BOUND === 100);
      const save = await throwsOn(() => t.prepare('SAVEPOINT s1').run());
      ok('D1 fact: SAVEPOINT is refused too', !!save && /transaction/i.test(save), save);
      const compound = (k) => t.prepare(Array.from({ length: k }, (x, i) => 'SELECT ' + i + ' AS n').join(' UNION ')).all();
      const at6 = await throwsOn(() => compound(6));
      ok('D1 fact: a compound SELECT of 5 terms answers and a 6th is refused (orphanSweep\'s UNION has 4)',
        !(await throwsOn(() => compound(5))) && !!at6 && /too many terms in compound SELECT/i.test(at6), at6);
      const like = (k) => t.prepare('SELECT ? LIKE ? AS m').bind('x', '%' + 'a'.repeat(k - 1)).all();
      const at51 = await throwsOn(() => like(51));
      const longest = Math.max(...core.JOURNEY_KEYS.map((k) => Buffer.byteLength('%"' + k + '"%')));
      ok('D1 fact: a LIKE pattern of 50 bytes answers and 51 are refused (retention\'s longest is ' + longest + ')',
        !(await throwsOn(() => like(50))) && !!at51 && /pattern too complex/i.test(at51) && longest <= 50, { at51, longest });
      /* first() here is all()'s first row, so its writes are metered; D1's own first() must agree. */
      const a = fresh(), b = fresh();
      const sql = 'INSERT INTO usage_meta (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(usage_meta.value AS INTEGER) + ?, at = excluded.at WHERE CAST(usage_meta.value AS INTEGER) + ? <= ? RETURNING value';
      const viaAll = [], viaFirst = [];
      for (let i = 0; i < 4; i++) {
        viaAll.push(await a.prepare(sql).bind('events_2026-11-16', '2', T0, 2, 2, 5).first());
        viaFirst.push(b.realFirst(sql, ['events_2026-11-16', '2', T0, 2, 2, 5]));
      }
      ok('first() as all()\'s first row answers what D1\'s own first() answers, and leaves the same row', stable(viaAll) === stable(viaFirst) && a.dump() === b.dump(), { viaAll, viaFirst });
    } else {
      /* Why the limits above are D1 facts: the shim takes every one of them. */
      const t = fresh();
      const takes = (sql, ...a) => { try { t.raw.prepare(sql).all(...a); return true; } catch (e) { return false; } };
      ok('the shim takes 101 parameters, a 6-term compound SELECT and a 51-byte LIKE pattern (only D1 refuses them)',
        takes('SELECT 1 AS y WHERE 0 IN (' + Array.from({ length: 101 }, () => '?').join(', ') + ')', ...Array.from({ length: 101 }, (x, i) => i + 1))
        && takes(Array.from({ length: 6 }, (x, i) => 'SELECT ' + i + ' AS n').join(' UNION ')) && takes('SELECT ? LIKE ? AS m', 'x', '%' + 'a'.repeat(50)));
    }
    /* No usage statement opens a transaction or calls exec() (D1's exec splits on newlines). */
    const W = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
    const usageSrc = [fs.readFileSync(path.join(root, 'workers', 'usage', 'core.mjs'), 'utf8'), fs.readFileSync(path.join(root, 'workers', 'admin', 'src', 'usage.mjs'), 'utf8'),
      W.slice(W.indexOf('/* ---- Usage events: POST /api/usage'), W.indexOf('export const __usage'))];
    const TXN = /prepare\(\s*['"`]\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b|\.exec\(\s*['"`]/i;
    ok('no usage statement opens a transaction or uses exec() (worker.js usage section, core.mjs, usage.mjs)', usageSrc[2].length > 1000 && !usageSrc.some((s) => TXN.test(s)));
    ok('companion: the same matcher finds a planted BEGIN', TXN.test("db.prepare('BEGIN').run()") && TXN.test('await db.exec(`DELETE`)'));
  });

  /* ---- 2a. ingest ---- */
  await section('ingest', async () => {
    const d = fresh();
    const visit = [ev('visit.started', { opened_from: 'notification', start: 'warm' }), ev('screen.viewed', { screen: 'log_medicine' }),
      ev('feature.used', { feature: 'medicine', action: 'logged' }), ev('push.permission', { state: 'asked' }), ev('push.permission', { state: 'granted' }),
      ev('visit.ended', { seconds: 70, reason: 'hidden' })];
    const r1 = await core.ingest(body(visit), ingestCtx(d, { uid: ME }));
    ok('ingest stores a whole visit of the founder\'s (6 events)', r1.status === 200 && r1.body.accepted === 6, r1);
    rec('ingest visit', r1);
    const r2 = await core.ingest(body(visit), ingestCtx(d, { uid: ME, now: T0 + MIN }));
    ok('a retry of the same batch stores nothing new (INSERT OR IGNORE)', r2.body.accepted === 0 && count(d, 'usage_events') === 6, r2);
    rec('ingest retry', r2);
    /* A membership answer with no household and no role (a person not confirmed yet). */
    const r3 = await core.ingest(body([ev('screen.viewed', { screen: 'home' }), ev('feature.used', { feature: 'feed', action: 'logged' })], { device: 'd_d1engine0002' }),
      ingestCtx(d, { uid: ME, now: T0 + 2 * MIN, membership: async () => ({ notice: '' }) }));
    ok('a membership with no household stores the events with no household', r3.body.accepted === 2 && count(d, 'usage_events', "device = 'd_d1engine0002' AND hid IS NULL AND role IS NULL") === 2, r3);
    rec('ingest no household', r3);
    const anonEnv = { USAGE_MODE: 'on', USAGE_DAILY_CAP: '100000' };
    const r4 = await core.ingest(body([ev('visit.started', { opened_from: 'icon', start: 'cold' }), ev('screen.viewed', { screen: 'signin' })], { device: 'd_d1anon000001', platform: 'browser' }),
      ingestCtx(d, { env: anonEnv, now: T0 + 3 * MIN }));
    ok('in mode on, a phone before sign-in stores its two allowed events', r4.body.accepted === 2 && count(d, 'usage_events', "who = 'anon_d_d1anon000001'") === 2, r4);
    rec('ingest anon', r4);
    const r5 = await core.ingest(body([ev('screen.viewed', { screen: 'pregnancy_week' }), ev('feature.used', { feature: 'kicks', action: 'logged' })], { device: 'd_d1engine0003' }),
      ingestCtx(d, { uid: ME, now: T0 + 4 * MIN }));
    ok('a pregnancy tool is counted only in an aggregate daily row (uid and hid empty)', r5.body.accepted === 2 && count(d, 'usage_daily', "uid = '' AND hid = '' AND key IN ('pregnancy_week', 'kicks')") === 2
      && count(d, 'usage_daily', "uid = '" + ME + "' AND key IN ('pregnancy_week', 'kicks')") === 0, rows(d, 'SELECT * FROM usage_daily'));
    rec('ingest journey', r5);
    const r6 = await core.ingest(body([{ name: 'nope' }, ev('visit.started', { opened_from: 'icon', start: 'cold' }, { id: 'x' }), ev('visit.started', { a: 1 })], { device: 'd_d1engine0004' }),
      ingestCtx(d, { uid: ME, now: T0 + 5 * MIN }));
    ok('refused events are counted by reason, never stored', r6.body.refused === 3 && count(d, 'usage_refused') === 3 && count(d, 'usage_events', "device = 'd_d1engine0004'") === 0, r6);
    rec('ingest refused', r6);
    /* The ceilings: a cap of 8 is 6 for families and 2 with no sign-in. */
    const c = fresh();
    const capEnv = { USAGE_MODE: 'internal', INTERNAL_UIDS: ME, USAGE_DAILY_CAP: '8' };
    const iso = core.newIsolate();
    const got = [];
    for (let i = 0; i < 4; i++) got.push((await core.ingest(body([ev('screen.viewed', { screen: 'home' }), ev('screen.viewed', { screen: 'timeline' })], { device: 'd_d1cap0000001' }),
      ingestCtx(c, { uid: ME, env: capEnv, isolate: iso, now: T0 + i * MIN }))).body);
    ok('the families\' share of a cap of 8 stores 6 and then refuses', got.map((g) => g.accepted).join() === '2,2,2,0' && count(c, 'usage_events') === 6
      && one(c, "SELECT n FROM usage_refused WHERE reason = 'ceiling'").n === 2, got);
    rec('ingest ceiling', got);
    rec('ingest tables', dumpOf(d));
    rec('ingest ceiling tables', dumpOf(c));
  });

  /* ---- 2b. retention, in chunks until drained ---- */
  await section('retention', async () => {
    const d = fresh();
    const put = d.raw.prepare('INSERT INTO usage_events (who, id, at, client_at, local_day, local_hour, tz, uid, hid, role, device, visit, platform, os, browser, app_version, name, props) '
      + "VALUES (?, ?, ?, ?, '2026-08-17', 6, 'UTC', ?, ?, 'owner', 'd_k3j9x2m7q1aa', ?, 'browser', 'macOS', 'Safari', 'v369', ?, ?)");
    const C90 = T0 - 90 * DAY, C30 = T0 - 30 * DAY;
    d.raw.exec('BEGIN');
    let k = 0;
    for (const uid of ['uidRetA00000000000000000001', 'uidRetB00000000000000000002', 'uidRetC00000000000000000003']) {
      for (let v = 0; v < 4; v++) {
        const at = C90 - (v + 1) * HOUR;   // expired visits
        put.run(uid, 'r' + (++k), at, at, uid, 'hhRet', 'v_ret' + uid.slice(6, 7).toLowerCase() + v + '00', 'visit.started', '{"opened_from":"icon","start":"cold"}');
        put.run(uid, 'r' + (++k), at + MIN, at + MIN, uid, 'hhRet', 'v_ret' + uid.slice(6, 7).toLowerCase() + v + '00', 'feature.used', '{"action":"logged","feature":"medicine"}');
        put.run(uid, 'r' + (++k), at + 2 * MIN, at + 2 * MIN, uid, 'hhRet', 'v_ret' + uid.slice(6, 7).toLowerCase() + v + '00', 'visit.ended', '{"reason":"hidden","seconds":120}');
      }
      // A visit whose head expired and whose end arrived 3 hours after the cutoff: it goes whole.
      put.run(uid, 'r' + (++k), C90 - MIN, C90 - MIN, uid, 'hhRet', 'v_retspan' + uid.slice(6, 7).toLowerCase(), 'visit.started', '{"opened_from":"icon","start":"cold"}');
      put.run(uid, 'r' + (++k), C90 + 3 * HOUR, C90 + 3 * HOUR, uid, 'hhRet', 'v_retspan' + uid.slice(6, 7).toLowerCase(), 'visit.ended', '{"reason":"idle","seconds":900}');
      // A young visit stays.
      put.run(uid, 'r' + (++k), T0 - DAY, T0 - DAY, uid, 'hhRet', 'v_retyoung' + uid.slice(6, 7).toLowerCase(), 'visit.started', '{"opened_from":"icon","start":"cold"}');
    }
    for (let i = 0; i < 7; i++) put.run('anon_d_k3j9x2m7q1aa', 'a' + i, C30 - (i + 1) * MIN, C30 - (i + 1) * MIN, null, null, 'v_anon000' + i, 'screen.viewed', '{"screen":"signin"}');
    for (let i = 0; i < 5; i++) put.run('uidRetA00000000000000000001', 'j' + i, C30 - (i + 1) * MIN, C30 - (i + 1) * MIN, 'uidRetA00000000000000000001', 'hhRet', 'v_journ00' + i, 'screen.viewed', '{"screen":"pregnancy_week"}');
    d.raw.prepare("INSERT INTO devices (device, uid, platform, os, browser, app_version, first_seen, last_seen) VALUES ('d_oldanon0001', NULL, 'browser', 'macOS', 'Safari', 'v360', ?, ?)").run(C30 - DAY, C30 - DAY);
    d.raw.prepare("INSERT INTO usage_daily VALUES ('2025-10-01', '', '', 'browser', 'screen', 'kicks', 4), ('2025-11-01', '', '', 'browser', 'screen', 'kicks', 4)").run();
    d.raw.prepare("INSERT INTO usage_refused VALUES ('2026-08-01', 'bad_event', 3), ('2026-11-15', 'bad_event', 1)").run();
    d.raw.prepare("INSERT INTO usage_meta (key, value, at) VALUES ('events_2026-08-01', '5', 1), ('events_2026-08-01_anon', '2', 1), ('events_2026-11-15', '9', 1)").run();
    d.raw.exec('COMMIT');
    const runs = [];
    /* Eight statements a call: one more than the seven classes, so a call that finds them all empty can say
       so (the cron's ten). */
    for (let i = 0; i < 60; i++) {
      const r = await core.runRetention(d, T0, { rows: 3, statements: 8 });
      runs.push(r);
      if (r.drained) break;
    }
    const last = runs[runs.length - 1];
    ok('retention in chunks of 3 rows and 8 statements drains (' + runs.length + ' calls)', last.drained && runs.length > 3, runs.length);
    ok('no call deleted more than its chunks', runs.every((r) => r.total <= 3 * 8));
    ok('no signed-in row past 90 days is left, and the young visits stayed', count(d, 'usage_events', 'uid IS NOT NULL AND at < ' + C90) === 0
      && count(d, 'usage_events', "visit LIKE 'v_retyoung%'") === 3, rows(d, 'SELECT id, visit, at FROM usage_events WHERE uid IS NOT NULL'));
    ok('a visit\'s later row left by a chunk\'s edge has lost its head (so the admin never shows it)', rows(d, "SELECT visit FROM usage_events WHERE visit LIKE 'v_retspan%'")
      .every((r) => count(d, 'usage_events', "visit = '" + r.visit + "' AND name = 'visit.started'") === 0));
    ok('anonymous and pregnancy rows past 30 days, the old device, aggregate, refusal and counter rows went', count(d, 'usage_events', 'uid IS NULL') === 0 && count(d, 'devices') === 0
      && count(d, 'usage_daily') === 1 && count(d, 'usage_refused') === 1 && one(d, 'SELECT group_concat(key) AS k FROM usage_meta').k === 'events_2026-11-15', dumpOf(d).slice(0, 600));
    rec('retention runs', runs);
    rec('retention tables', dumpOf(d));
  });

  /* ---- 2c. erasure in steps, resumed over UTC days ---- */
  await section('erasure', async () => {
    const d = fresh();
    const P = 'uidErase000000000000000000P', Q = 'uidErase000000000000000000Q', H = 'hhErase0001', H2 = 'hhErase0002';
    const ins = d.raw.prepare('INSERT INTO usage_events (who, id, at, client_at, local_day, local_hour, tz, uid, hid, role, device, visit, platform, os, browser, app_version, name, props) '
      + "VALUES (?, ?, ?, ?, '2026-11-15', 9, 'UTC', ?, ?, 'owner', ?, ?, 'ios_app', 'iOS 26.1', 'Safari', 'v369', ?, ?)");
    d.raw.exec('BEGIN');
    let k = 0;
    const visitRows = (uid, hid, v, dose) => {
      const at = T0 - DAY + v * HOUR;
      const vid = 'v_' + uid.slice(-1).toLowerCase() + 'ers' + String(v).padStart(4, '0');
      ins.run(uid, 'x' + (++k), at, at, uid, hid, 'd_erase000000' + uid.slice(-1).toLowerCase(), vid, 'visit.started', '{"opened_from":"icon","start":"cold"}');
      ins.run(uid, 'x' + (++k), at + MIN, at + MIN, uid, hid, 'd_erase000000' + uid.slice(-1).toLowerCase(), vid, 'feature.used', dose ? '{"action":"logged","feature":"medicine"}' : '{"action":"logged","feature":"feed"}');
      ins.run(uid, 'x' + (++k), at + 2 * MIN, at + 2 * MIN, uid, hid, 'd_erase000000' + uid.slice(-1).toLowerCase(), vid, 'visit.ended', '{"reason":"hidden","seconds":120}');
    };
    for (let v = 0; v < 6; v++) visitRows(P, H, v, v === 2);
    for (let v = 0; v < 3; v++) visitRows(Q, H, v, false);
    for (let v = 3; v < 5; v++) visitRows(Q, H2, v, false);
    for (const [u, h] of [[P, H], [Q, H]]) {
      for (let i = 0; i < 4; i++) d.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES (?, ?, ?, 'ios_app', 'visits', '', 1)").run('2026-11-1' + i, u, h);
      d.raw.prepare("INSERT INTO devices (device, uid, platform, os, browser, app_version, first_seen, last_seen) VALUES (?, ?, 'ios_app', 'iOS 26.1', 'Safari', 'v369', 1, 1)").run('d_erase000000' + u.slice(-1).toLowerCase(), u);
      d.raw.prepare("INSERT INTO membership (uid, hid, role, notice, checked_at) VALUES (?, ?, 'owner', '', 1)").run(u, h);
      d.raw.prepare("INSERT INTO nudges (id, hid, uid, channel, template, body, sent_by, state, at) VALUES (?, ?, ?, 'note', 't', 'b', 'Saurav', 'sent', 1)").run('n_' + u.slice(-8).toLowerCase(), h, u);
      d.raw.prepare("INSERT INTO shared_entries (id, hid, shared_by, entry_id, entry, at, expires_at) VALUES (?, ?, ?, 'e1', '{}', 1, 2)").run('s_' + u, h, u);
    }
    d.raw.exec('COMMIT');
    const left = (where) => ['usage_events', 'usage_daily', 'devices', 'membership', 'nudges'].map((t) => count(d, t, where)).reduce((a, b) => a + b, 0) + count(d, 'shared_entries', where.replace(/\buid\b/g, 'shared_by'));
    const budget = { allowance: 14, dayMax: 4 };   // a floor of 10 a day: 8 rows a step after its own two
    const steps = [];
    steps.push(await core.eraseUid(d, P, T0, budget));
    ok('the account purge\'s first step takes what today\'s floor allows and puts the rest on record', steps[0].ran && !steps[0].done && steps[0].erased === 8
      && count(d, 'usage_meta', "key = '" + core.PENDING_UID + P + "'") === 1, steps[0]);
    ok('her membership row went first (nothing links her after the first step)', count(d, 'membership', "uid = '" + P + "'") === 0);
    for (let day = 1; day <= 12 && left("uid = '" + P + "'"); day++) steps.push(await core.erasePending(d, T0 + day * DAY, budget, 3));
    ok('erasePending carries her on, one floor a UTC day, until nothing of hers is left', left("uid = '" + P + "'") === 0 && steps.length > 3, { steps, left: left("uid = '" + P + "'") });
    // The hold ends and the marker goes.
    await core.erasePending(d, T0 + 14 * DAY, budget, 3);
    ok('and her marker is cleared once nothing is left and the hold is over', count(d, 'usage_meta', "key = '" + core.PENDING_UID + P + "'") === 0);
    ok('companion: the other person\'s rows are all still there', left("uid = '" + Q + "'") === 15 + 4 + 1 + 1 + 1 + 1);
    rec('erase uid steps', steps);
    rec('erase uid tables', dumpOf(d));
    // The household: its marker first, then steps under it.
    await core.markHidErase(d, H, T0 + 15 * DAY);
    const hsteps = [await core.eraseHid(d, H, T0 + 15 * DAY, budget)];
    for (let day = 16; day <= 30 && count(d, 'usage_meta', "key = '" + core.PENDING_HID + H + "'"); day++) hsteps.push(await core.erasePending(d, T0 + day * DAY, budget, 3));
    ok('a household erasure goes in steps until its marker is cleared', count(d, 'usage_meta', "key = '" + core.PENDING_HID + H + "'") === 0 && hsteps.length > 1, hsteps);
    ok('nothing carries that household any more, and its member is linked to none', count(d, 'usage_events', "hid = '" + H + "'") === 0 && count(d, 'usage_daily', "hid = '" + H + "'") === 0
      && one(d, "SELECT hid FROM membership WHERE uid = '" + Q + "'").hid === null);
    ok('companion: her rows in the other household stay', count(d, 'usage_events', "hid = '" + H2 + "'") === 6);
    rec('erase hid steps', hsteps);
    rec('erase hid tables', dumpOf(d));
  });

  /* ---- 2d. a step whose batch fails inside D1 changes nothing ---- */
  await section('atomic step', async () => {
    const d = fresh();
    const P = 'uidAtomic00000000000000000P';
    d.raw.prepare("INSERT INTO membership (uid, hid, role, notice, checked_at) VALUES (?, 'hhAtom01', 'owner', '', 1)").run(P);
    d.raw.prepare("INSERT INTO devices (device, uid, platform, os, browser, app_version, first_seen, last_seen) VALUES ('d_atomic000001', ?, 'browser', 'macOS', 'Safari', 'v369', 1, 1)").run(P);
    d.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES ('2026-11-15', ?, 'hhAtom01', 'browser', 'visits', '', 1)").run(P);
    d.raw.exec("CREATE TRIGGER _stop BEFORE DELETE ON usage_daily BEGIN SELECT RAISE(ABORT, 'staged failure'); END");
    const err = await throwsOn(() => core.eraseUid(d, P, T0, { allowance: 1000, dayMax: 100 }));
    ok('a step whose batch fails at its last statement throws', !!err && /staged failure/.test(err), err);
    ok('and the deletes before it in the same batch are undone (membership, devices)', count(d, 'membership', "uid = '" + P + "'") === 1 && count(d, 'devices', "uid = '" + P + "'") === 1 && count(d, 'usage_daily') === 1);
    ok('its marker stays, due at once (so the next tick retries it)', one(d, "SELECT at FROM usage_meta WHERE key = ?", core.PENDING_UID + P).at === T0);
    d.raw.exec('DROP TRIGGER _stop');
    await core.erasePending(d, T0 + MIN, { allowance: 1000, dayMax: 100 }, 3);
    ok('companion: with the failure gone the cron finishes it', count(d, 'membership') === 0 && count(d, 'devices') === 0 && count(d, 'usage_daily') === 0);
    rec('atomic tables', dumpOf(d));
  });

  /* ---- 2e. the weekly orphan sweep over 150 people ---- */
  await section('orphan sweep', async () => {
    const d = fresh();
    const uids = Array.from({ length: 150 }, (x, i) => 'uidSweep' + String(i).padStart(20, '0'));
    d.raw.exec('BEGIN');
    const ins = d.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES ('2026-11-15', ?, 'hhSweep', 'browser', 'visits', '', 1)");
    for (const u of uids) ins.run(u);
    d.raw.exec('COMMIT');
    const known = new Set(uids.filter((u, i) => i % 5 === 0));
    const asked = [];
    const marked = await core.orphanSweep(d, async (part) => { asked.push(part.length); return { known: new Set(part.filter((u) => known.has(u))) }; }, T0, 100);
    ok('the sweep asks Auth in hundreds and puts each of the 120 gone on record', marked === 120 && asked.join() === '100,50'
      && count(d, 'usage_meta', "key >= 'erase_uid:' AND key < 'erase_uid;'") === 120, { marked, asked });
    const e = fresh();
    e.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES ('2026-11-15', 'uidX', 'h', 'browser', 'visits', '', 1)").run();
    const err = await throwsOn(() => core.orphanSweep(e, async () => { throw new Error('auth down'); }, T0, 100));
    ok('companion: a lookup that fails marks nobody', !!err && count(e, 'usage_meta') === 0, err);
    rec('sweep', { marked, asked, tables: dumpOf(d) });
  });

  /* ---- 2f. worker.js usageMembership: its read, its upsert, its backfill ---- */
  await section('membership', async () => {
    const w = await imp(root, 'worker.js', true);
    const d = fresh();
    const U1 = 'uidMemb000000000000000000001', U2 = 'uidMemb000000000000000000002';
    docs.clear();
    docs.set('users/' + U1, { householdId: { stringValue: 'hhMemb01' }, privacyNoticeSeen: { stringValue: '' } });
    docs.set('users/' + U2, { householdId: { stringValue: 'hhMemb01' }, privacyNoticeSeen: { stringValue: '' } });
    docs.set('households/hhMemb01', { members: { mapValue: { fields: { [U1]: { stringValue: 'owner' }, [U2]: { stringValue: 'caregiver' } } } } });
    const ins = d.raw.prepare('INSERT INTO usage_events (who, id, at, client_at, local_day, local_hour, tz, uid, device, visit, platform, os, browser, app_version, name, props) '
      + "VALUES (?, ?, ?, ?, '2026-11-16', 5, 'UTC', ?, 'd_memb00000001', 'v_memb0001', 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{\"screen\":\"home\"}')");
    for (let i = 0; i < 3; i++) ins.run(U1, 'm' + i, T0 - (i + 1) * HOUR, T0 - (i + 1) * HOUR, U1);
    const env = { USAGE_DB: d, USAGE_MODE: 'internal', INTERNAL_UIDS: U1 + ',' + U2, FIREBASE_SERVICE_ACCOUNT: SA, PRIVACY_NOTICE: '' };
    const m0 = d.meter ? d.meter.rows_written : 0;
    const a1 = await w.__usage.usageMembership(env, U1, T0);
    const w1 = d.meter ? d.meter.rows_written - m0 : null;
    ok('usageMembership confirms her household from Firestore and stores the row', a1.hid === 'hhMemb01' && a1.role === 'owner'
      && one(d, 'SELECT hid FROM membership WHERE uid = ?', U1).hid === 'hhMemb01', a1);
    ok('and stamps her 3 rows of the last 24 hours that had no household', count(d, 'usage_events', "uid = '" + U1 + "' AND hid = 'hhMemb01' AND role = 'owner'") === 3);
    const m1 = d.meter ? d.meter.rows_written : 0;
    const a2 = await w.__usage.usageMembership(env, U2, T0 + MIN);
    const w2 = d.meter ? d.meter.rows_written - m1 : null;
    ok('a second person: her row too', a2.hid === 'hhMemb01' && a2.role === 'caregiver', a2);
    const a3 = await w.__usage.usageMembership(env, U1, T0 + 2 * MIN);
    ok('within the 6 hours her stored row answers', a3.hid === 'hhMemb01' && Number(a3.checked_at) === T0, a3);
    d.raw.prepare('INSERT INTO usage_meta (key, value, at) VALUES (?, ?, ?)').run(core.PENDING_UID + U1, String(T0), T0);
    const a4 = await w.__usage.usageMembership(env, U1, T0 + 3 * MIN);
    ok('while her erasure is on record she is linked to nobody (the LEFT JOIN read)', a4.hid === null && a4.role === null, a4);
    facts.membershipWrites = { first: w1, second: w2 };
    rec('membership', { a1, a2, a3, a4, tables: dumpOf(d) });
  });

  /* ---- 2g. every read in workers/admin/src/usage.mjs ---- */
  await section('admin reads', async () => {
    const sample = await imp(root, 'workers/admin/dev/sample.mjs', true);
    const d = fresh();
    await sample.seedUsage(d);
    const uids = rows(d, 'SELECT DISTINCT uid FROM usage_events WHERE uid IS NOT NULL ORDER BY uid').map((r) => r.uid);
    const hids = rows(d, 'SELECT DISTINCT hid FROM usage_events WHERE hid IS NOT NULL ORDER BY hid').map((r) => r.hid);
    const cfgOf = (list) => ({ usage: usage.readOnly(d), internal: new Set(list) });
    const NOW = sample.NOW;
    const reads = async (cfg) => {
      const out = {};
      for (const [range, n] of [['7', 7], ['30', 30], ['90', 90]]) out['overview ' + range] = await usage.usageOverview(cfg, NOW, new Date(NOW - (n - 1) * DAY).toISOString().slice(0, 10), n, false);
      out['overview hidden'] = await usage.usageOverview(cfg, NOW, '2026-11-07', 7, true);
      for (const h of hids) out['household ' + h] = await usage.usageHousehold(cfg, { hid: h, members: uids.map((u) => ({ uid: u })) }, NOW);
      out.counts = await usage.usageCounts(cfg, false);
      /* usageTab throws when D1 refuses; index.mjs answers that as 'error', and so does this. */
      const tab = async (t, all) => { try { return await usage.usageTab(cfg, t, false, 1, all); } catch (e) { return { state: 'error', total: 0, rows: [], threw: String(e.message || e).slice(0, 80) }; } };
      for (const t of usage.USAGE_TABS) { out['tab ' + t] = await tab(t, false); out['csv ' + t] = await tab(t, true); }
      return out;
    };
    const plain = await reads(cfgOf(uids));
    const states = Object.entries(plain).filter(([k]) => k !== 'counts').map(([k, v]) => k + ':' + v.state);
    ok('every admin read answers on the sample families (' + states.length + ' reads)', states.every((s) => /:(ok|hidden)$/.test(s)) && plain['overview 7'].tiles.measured > 0, states);
    rec('admin reads', plain);
    /* SCOPE_MAX uids: the saving line binds 3 x 33 + 1 = 100 parameters, D1's most. Every read must answer. */
    eng.resetMaxParams();
    const full = uids.concat(Array.from({ length: usage.SCOPE_MAX - uids.length }, (x, i) => FILLER(i)));
    const atMax = await reads(cfgOf(full));
    const bad = Object.entries(atMax).filter(([k, v]) => k !== 'counts' && v.state !== 'ok' && v.state !== 'hidden').map(([k, v]) => k + ':' + v.state);
    ok('at SCOPE_MAX (' + usage.SCOPE_MAX + ') uids every read still answers', bad.length === 0 && Object.values(atMax.counts).every((n) => n !== null), { bad, counts: atMax.counts });
    if (D1) ok('and the most parameters any of them bound is D1\'s 100 at most (' + eng.maxParams(kind) + ', 3 x ' + usage.SCOPE_MAX + ' + 1)', eng.maxParams(kind) <= 100 && eng.maxParams(kind) === 3 * usage.SCOPE_MAX + 1);
    facts.maxParams = eng.maxParams(kind);
    if (D1) {
      facts.maxSqlBytes = eng.mf.engineStats.maxSqlBytes;
      ok('and the longest statement is well inside D1\'s 100,000 bytes (' + facts.maxSqlBytes + ')', facts.maxSqlBytes > 0 && facts.maxSqlBytes < 100000);
    }
    rec('admin reads at SCOPE_MAX', atMax);
    const over = await reads(cfgOf(full.concat([FILLER(999)])));
    const notErr = Object.entries(over).filter(([k, v]) => k !== 'counts' && k !== 'overview hidden' && v.state !== 'error').map(([k]) => k);
    ok('past SCOPE_MAX every panel says it could not be read, on every engine', notErr.length === 0 && Object.values(over.counts).every((n) => n === null), notErr);
    rec('admin reads past SCOPE_MAX', over);
  });

  /* ---- 3. D1's own meter against wrangler.toml's write arithmetic ---- */
  if (D1) await section('the meter', async () => {
    const toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
    const num = (re) => { const m = re.exec(toml); return m ? Number(String(m[1]).replace(/,/g, '')) : NaN; };
    const st = {
      store: num(/^#\s+storing\s+(\d+) x C\b/m), events: num(/usage_events (\d+) \(WITHOUT ROWID/), daily: num(/a new usage_daily row (\d+)\b/), device: num(/never seen before (\d+) \(row, key, dev_uid\)/),
      refusals: num(/^#\s+refusals\s+([\d,]+)\s/m), membership: num(/^#\s+membership\s+([\d,]+)\s/m), del: num(/^#\s+retention and\s+(\d+) x X\b/m), rest: num(/^#\s+the rest\s+(\d+)\s/m),
      total: num(/^# At [\d,]+ that is [\d,+ ]+ = ([\d,]+),/m), cap: num(/^USAGE_DAILY_CAP\s*=\s*"(\d+)"/m),
    };
    ok('wrangler.toml states every term this section checks', Object.values(st).every((v) => Number.isFinite(v)), st);
    const metered = async (d, fn) => { const w0 = d.meter.rows_written; await fn(); return d.meter.rows_written - w0; };
    const d = fresh();
    const ctx = (o) => ingestCtx(d, Object.assign({ uid: ME }, o));
    await core.ingest(body([ev('screen.viewed', { screen: 'home' })], { device: 'd_meter0000000' }), ctx({ now: T0 }));   // the day's counter exists from here
    const perEvent = await metered(d, () => core.ingest(body([ev('screen.viewed', { screen: 'timeline' })], { device: 'd_meter0000001' }), ctx({ now: T0 + MIN })));
    ok('one event a batch, a new device and a new daily total: D1 bills ' + perEvent + ' rows, as wrangler.toml states (' + st.store + ' = counter 1 + events '
      + st.events + ' + daily ' + st.daily + ' + device ' + st.device + ')', perEvent === st.store && st.store === 1 + st.events + st.daily + st.device, { perEvent, st });
    const asStored = await metered(d, () => core.ingest(body([ev('screen.viewed', { screen: 'timeline' })], { device: 'd_meter0000001' }), ctx({ now: T0 + 2 * MIN })));
    ok('companion: the same shape on a device and a total already stored bills less (' + asStored + ')', asStored < perEvent && asStored > st.events, asStored);
    /* The household backfill, worker.js's own statement. */
    const W = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
    const FILL = 'UPDATE usage_events SET hid = ?, role = ? WHERE uid = ? AND hid IS NULL AND at >= ?';
    ok('worker.js backfills a confirmed household with this statement', W.includes("db.prepare('" + FILL + "')"));
    const f = fresh();
    const insf = f.raw.prepare('INSERT INTO usage_events (who, id, at, client_at, local_day, local_hour, tz, uid, device, visit, platform, os, browser, app_version, name, props) '
      + "VALUES (?, ?, ?, ?, '2026-11-16', 5, 'UTC', ?, 'd_fill00000001', 'v_fill0001', 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{}')");
    for (let i = 0; i < 10; i++) insf.run(ME, 'f' + i, T0 - i * MIN, T0 - i * MIN, ME);
    const fill = await metered(f, () => f.prepare(FILL).bind('hhFill01', 'owner', ME, T0 - DAY).run());
    ok('the backfill bills 2 rows a row (the row and ue_hid_at), as wrangler.toml states (' + fill + ' for 10)', fill === 20, fill);
    /* Refusals: a new reason row is its row and key, a repeat one row; each moves the counter once. */
    const r = fresh();
    const rctx = (now) => ingestCtx(r, { uid: ME, now });
    await core.ingest(body([{ name: 'nope' }]), rctx(T0));                                   // the day's refusal counter exists from here
    const newReason = await metered(r, () => core.ingest(body([ev('visit.started', { a: 1 })]), rctx(T0 + MIN)));
    const sameReason = await metered(r, () => core.ingest(body([ev('visit.started', { a: 1 })]), rctx(T0 + 2 * MIN)));
    ok('a refusal bills 2 rows, 3 for a new reason (' + sameReason + ', ' + newReason + '): ' + st.refusals + ' = 500 x 2 + 9 + 1', sameReason === 2 && newReason === 3 && st.refusals === core.REFUSED_DAILY_ROWS * 2 + 10, { sameReason, newReason });
    /* Membership: measured in 2f through worker.js (counter, row and key, and her backfill). */
    const mw = facts.membershipWrites || {};
    ok('a new membership row bills 3 with its counter (' + mw.second + '): ' + st.membership + ' = 1,000 x 3 + 1', mw.second === 3 && st.membership === core.MEMBERSHIP_DAILY_ROWS * 3 + 1, mw);
    ok('companion: the day\'s first one, with 3 rows to backfill, bills 2 + 2 + 3 x 2 (' + mw.first + ')', mw.first === 10, mw);
    /* Deletes: what retention and an erasure step bill per row on D1's meter. */
    const x = fresh();
    const insx = x.raw.prepare('INSERT INTO usage_events (who, id, at, client_at, local_day, local_hour, tz, uid, hid, device, visit, platform, os, browser, app_version, name, props) '
      + "VALUES (?, ?, ?, ?, '2026-08-01', 5, 'UTC', ?, 'hhDel01', 'd_del000000001', ?, 'browser', 'macOS', 'Safari', 'v369', 'screen.viewed', '{}')");
    x.raw.exec('BEGIN');
    for (let i = 0; i < 300; i++) insx.run(ME, 'd' + i, T0 - 91 * DAY - i * MIN, T0 - 91 * DAY - i * MIN, ME, 'v_del' + String(i).padStart(5, '0'));
    x.raw.exec('COMMIT');
    let gone = 0;
    const delRows = await metered(x, async () => { gone = (await core.runRetention(x, T0, { rows: 100, statements: 10 })).events; });
    ok('retention\'s deletes bill at most ' + st.del + ' rows a row (' + delRows + ' for ' + gone + ')', gone === 300 && delRows <= st.del * gone, { delRows, gone });
    facts.deletePerRow = gone ? delRows / gone : null;
    const y = fresh();
    for (let i = 0; i < 40; i++) y.raw.prepare("INSERT INTO usage_daily (local_day, uid, hid, platform, metric, key, n) VALUES (?, ?, 'h', 'browser', 'screen', ?, 1)").run('2026-11-01', ME, 'k' + i);
    let er = null;
    const eraseRows = await metered(y, async () => { er = await core.eraseUid(y, ME, T0, { allowance: 1000, dayMax: 100 }); });
    ok('an erase step bills at most ' + st.del + ' a row and its own two (' + eraseRows + ' for ' + (er && er.erased) + ')', er && er.erased === 40 && eraseRows <= st.del * 40 + 4, { eraseRows, er });
    /* The worst UTC day at the shipped cap, on D1's meter, against the stated figure. */
    const w = await imp(root, 'worker.js', true);
    const cap = st.cap, L = cap - Math.floor(cap / 4), X = w.__usage.retentionDailyRows({ USAGE_DAILY_CAP: String(cap) });
    const worst = cap * perEvent + 2 * L * (fill / 10) + (core.REFUSED_DAILY_ROWS * sameReason + 9 + 1) + (core.MEMBERSHIP_DAILY_ROWS * mw.second + 1) + X * Math.max(1, Math.ceil(facts.deletePerRow || 0)) + st.rest;
    facts.worstDay = { measured: worst, stated: st.total, cap };
    ok('the worst UTC day on D1\'s own meter (' + worst + ' rows) is within the stated ' + st.total + ', under half of 100,000', worst <= st.total && st.total < 50000, facts.worstDay);
    /* wrangler.toml says what this section measured; the sentence must say what it measures now. */
    const said = /measures them on workerd's own D1 meter \(rows_written\): (\d+) a\s*#?\s*stored event, (\d+) a filled row, (\d+) a refusal, (\d+) a membership row, and (\d+) a deleted row,[^(]*\(([\d,]+) on that meter at ([\d,]+)\)/.exec(toml.replace(/\n#\s*/g, ' '));
    const measured = [perEvent, fill / 10, sameReason, mw.second, facts.deletePerRow, worst, cap];
    ok('wrangler.toml\'s sentence on D1\'s meter says what was measured (' + measured.join(', ') + ')', !!said && said.slice(1).map((v) => Number(v.replace(/,/g, ''))).join() === measured.join(), said && said.slice(1));
  });

  return { pass, fail, failed, trace, facts };
}

/* ---------- the engines ---------- */

async function engines(root) {
  const shim = await imp(root, 'workers/admin/dev/d1-sqlite.mjs');
  const mf = await imp(root, 'workers/admin/dev/d1-miniflare.mjs');
  return {
    mf,
    make: (kind, o) => (kind === 'd1' ? mf.makeD1(Object.assign({ shadow: false }, o), { makeSqliteD1: shim.makeSqliteD1, norm: shim.norm }) : shim.makeSqliteD1(o)),
    maxParams: (kind) => (kind === 'd1' ? mf.engineStats.maxParams : 0),
    resetMaxParams: () => { mf.engineStats.maxParams = 0; },
  };
}

/* Both engines over one tree, and every recorded answer compared. */
async function bothEngines(root, eng, quiet) {
  const d1 = await scenario(root, 'd1', eng, quiet);
  const sq = await scenario(root, 'sqlite', eng, quiet);
  const differ = [];
  for (const [k, v] of sq.trace) if (d1.trace.get(k) !== v) differ.push(k);
  for (const k of d1.trace.keys()) if (!sq.trace.has(k)) differ.push(k);
  return { d1, sq, differ };
}

/* ---------- the usage suites, unchanged, on D1 ---------- */

function run(cmd, env, cwd) {
  return new Promise((res) => {
    const p = spawn(cmd[0], cmd.slice(1), { cwd: cwd || ROOT, env });
    let out = '';
    p.stdout.on('data', (x) => { out += x; });
    p.stderr.on('data', (x) => { out += x; });
    p.on('close', (code) => res({ code, out }));
    p.on('error', (e) => res({ code: 127, out: String(e.message) }));
  });
}
/* The suite's own verdict: "<n> passed, <m> failed" and "<NAME>: PASS". */
function verdict(out) {
  const counts = [...String(out).matchAll(/^(\d+) passed, (\d+) failed$/gm)].pop();
  const pass = /^[A-Z][A-Z0-9-]+: PASS$/m.test(out) && !/^[A-Z][A-Z0-9-]+: FAIL$/m.test(out);
  return { passed: counts ? Number(counts[1]) : null, failed: counts ? Number(counts[2]) : null, pass };
}
const SUITES = ['usage-ingest', 'usage-route', 'usage-erasure', 'admin-screens'];

async function suitesOnD1(ok, ports) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-usage-d1-'));
  const baseEnv = Object.assign({}, process.env);
  for (const k of Object.keys(baseEnv)) if (/^GIT_/.test(k) || /^CUBBY_D1_/.test(k)) delete baseEnv[k];
  try {
    let i = 0;
    for (const s of SUITES) {
      const file = 'test/' + s + '.test.js';
      const shim = await run(['node', file], baseEnv);
      const report = path.join(scratch, s + '.jsonl');
      const t0 = Date.now();
      const onD1 = await run(['node', file], Object.assign({}, baseEnv, { CUBBY_D1_ENGINE: 'miniflare', CUBBY_D1_SHADOW: '1', CUBBY_D1_REPORT: report, CUBBY_D1_PORT: String(ports[i++ % ports.length]) }));
      const a = verdict(shim.out), b = verdict(onD1.out);
      let rep = null;
      try { rep = JSON.parse(fs.readFileSync(report, 'utf8').trim().split('\n').pop()); } catch (e) { rep = null; }
      console.log('  ' + s.padEnd(14) + ' shim ' + a.passed + ' passed; D1 ' + b.passed + ' passed in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's'
        + (rep ? ', ' + rep.dbs + ' databases, ' + (rep.api.statements + rep.raw.statements) + ' statements, ' + rep.api.rows_written + ' rows written by the code under test, '
          + rep.shadowed + ' answers compared, ' + rep.mismatchCount + ' different' + (rep.triggerCounted ? ' (' + rep.triggerCounted + ' counted a test trigger\'s rows)' : '') : ''));
      ok(s + ' passes on the shim', shim.code === 0 && a.pass, shim.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 5));
      ok(s + ' passes on D1', onD1.code === 0 && b.pass, onD1.out.split('\n').filter((l) => /FAIL|Error/.test(l)).slice(0, 8));
      ok(s + ' runs the same number of checks on D1 as on the shim (' + b.passed + ')', a.passed !== null && a.passed === b.passed && b.failed === 0, { shim: a, d1: b });
      ok(s + ': its statements really ran on Miniflare\'s D1', !!rep && rep.engine === 'miniflare' && rep.dbs > 0 && rep.api.statements > 0 && /^5\./.test(String(rep.miniflare)), rep && { engine: rep.engine, dbs: rep.dbs });
      ok(s + ': every statement answered on D1 exactly as on node:sqlite', !!rep && rep.mismatchCount === 0 && rep.shadowed > 0, rep && rep.mismatches.slice(0, 5));
      ok(s + ': its Miniflare opened no socket beyond loopback', !!rep && Array.isArray(rep.outbound) && rep.outbound.length === 0, rep && rep.outbound);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/* ---------- the self-test: breaks only D1 can see ---------- */

const MUTANTS = [
  { name: 'the scope bound raised past D1\'s 100 parameters (49 uids bind 148)', d1Only: true,
    file: 'workers/admin/src/usage.mjs', find: 'export const SCOPE_MAX = Math.floor((D1_MAX_BOUND - 1) / 3);', put: 'export const SCOPE_MAX = Math.floor((D1_MAX_BOUND - 1) / 2);' },
  { name: 'ingest binds a missing household and role as undefined (the shim stores NULL, D1 refuses the batch)', d1Only: true,
    file: 'workers/usage/core.mjs', find: 'mem ? mem.hid || null : null, mem ? mem.role || null : null,', put: 'mem ? mem.hid : null, mem ? mem.role : null,' },
  { name: 'the orphan sweep marks its hundred people in one statement (300 parameters)', d1Only: true,
    file: 'workers/usage/core.mjs', find: 'await db.batch(gone.map((u) => db.prepare(MARK).bind(PENDING_UID + u, String(now), now)));',
    put: "await db.prepare('INSERT INTO usage_meta (key, value, at) VALUES ' + gone.map(() => '(?, ?, ?)').join(', ') + ' ON CONFLICT(key) DO NOTHING').bind(...gone.flatMap((u) => [PENDING_UID + u, String(now), now])).run();" },
  { name: 'a fifth index on usage_events (one more billed row an event than wrangler.toml states)', d1Only: true,
    file: 'schema/usage.sql', find: 'CREATE INDEX IF NOT EXISTS ue_at     ON usage_events(at);', put: 'CREATE INDEX IF NOT EXISTS ue_at     ON usage_events(at);\nCREATE INDEX IF NOT EXISTS ue_name ON usage_events(name);' },
  { name: 'wrangler.toml states another worst day on D1\'s meter than the one measured', d1Only: true,
    file: 'wrangler.toml', find: '(31,586 on that meter at 1,500)', put: '(31,000 on that meter at 1,500)' },
  { name: 'the orphan sweep reads two more tables (a compound SELECT of 6 terms; D1 takes 5, and a fifth term runs)', d1Only: true,
    file: 'workers/usage/core.mjs', find: 'UNION SELECT uid FROM membership)', put: 'UNION SELECT uid FROM membership UNION SELECT uid FROM nudges UNION SELECT shared_by FROM shared_entries)' },
  { name: 'a journey key whose retention LIKE pattern is 51 bytes (D1 takes 50)', d1Only: true,
    file: 'workers/usage/core.mjs', find: "export const JOURNEY_KEYS = ['pregnancy_week', 'kicks', 'contractions', 'cycle'];",
    put: "export const JOURNEY_KEYS = ['pregnancy_week', 'kicks', 'contractions', 'cycle', 'a_journey_screen_whose_name_runs_past_the_limit'];" },
  { name: 'usage_events loses WITHOUT ROWID', d1Only: false,
    file: 'schema/usage.sql', find: '  PRIMARY KEY (who, id)\n) WITHOUT ROWID;', put: '  PRIMARY KEY (who, id)\n);' },
  { name: 'the account purge\'s step deletes statement by statement, outside one batch', d1Only: false,
    file: 'workers/usage/core.mjs', find: 'try { res = await db.batch(deletes); }', put: 'try { res = []; for (const s of deletes) res.push(await s.run()); }' },
];
/* The harness of a copy started WITHOUT `cf: false`: Miniflare then reaches for workers.cloudflare.com/cf.json
   (this machine's location) when it starts. The host thread must catch that, and refuse it before DNS. */
const OFFLINE_MUTANT = { name: 'Miniflare started without cf: false', file: 'workers/admin/dev/d1-miniflare-host.mjs',
  find: "host: '127.0.0.1', port: m.port, cf: false,", put: "host: '127.0.0.1', port: m.port," };
/* This test's --hold child with no tether to its parent (as before 16 Nov 2026), in a copy of this file: its parent's
   SIGKILL must be caught leaving it and its workerd running. The anchor starts at a line break, so it matches
   hold()'s line and not this string. */
const TETHER_MUTANT = { name: 'a --hold child with no tether to its parent', file: 'test/usage-d1-engine.test.js',
  find: "\n  process.stdin.on('end', () => process.exit(0)); process.stdin.on('error', () => process.exit(0)); process.stdin.resume();", put: '\n  /* no tether */' };
/* The harness of a copy with no signal handlers (as before 16 Nov 2026): a SIGTERM must be caught leaving workerd. */
const SIGNAL_MUTANT = { name: 'a harness that disposes on exit only', file: 'workers/admin/dev/d1-miniflare.mjs',
  find: 'for (const s of SIGNALS) process.on(s, onSignal);', put: '/* no signal handlers */' };

/* --probe <tree>: a child of the self-test. One D1 from that tree's own harness answers one statement, and the
   child prints what Miniflare's thread tried to reach beyond loopback. */
async function probe(tree) {
  const mf = await import(pathToFileURL(path.join(tree, 'workers', 'admin', 'dev', 'd1-miniflare.mjs')).href);
  const d = mf.makeD1({ shadow: false }, { makeSqliteD1: null, norm: null });
  const row = await d.prepare('SELECT 41 + 1 AS n').first();
  console.log('PROBE ' + JSON.stringify({ n: row ? row.n : null, outbound: mf.outboundAttempts() }));
}
/* A child's environment: no NODE_ENV=test and no CLOUDFLARE_CF_FETCH_* (either would stop Miniflare's fetch
   before the guard could see it), that Miniflare, and workerd on that port. */
function childD1Env(mfi, port) {
  const env = Object.assign({}, process.env);
  for (const k of Object.keys(env)) if (/^GIT_|^CUBBY_D1_|^CLOUDFLARE_CF_FETCH_/.test(k) || k === 'NODE_ENV') delete env[k];
  return Object.assign(env, { MINIFLARE_PATH: mfi.dir, CUBBY_D1_PORT: String(port || 0) });
}
/* The probe's verdict, from a fresh process whose Miniflare nothing has cached for. */
async function probeTree(tree, mfi, port) {
  const env = childD1Env(mfi, port);
  const r = await run(['node', path.join(ROOT, 'test', 'usage-d1-engine.test.js'), '--probe', tree], env, tree);
  const m = /^PROBE (.*)$/m.exec(r.out);
  let got = null;
  try { got = m ? JSON.parse(m[1]) : null; } catch (e) { got = null; }
  return got || { n: null, outbound: null, out: r.out.slice(-400) };
}

/* Section 0's helpers for the processes it starts and signals. */
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const listeningOn = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return !!(await fn()); };
const childrenOf = (pid) => String(require('child_process').spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).stdout || '').split('\n').map(Number).filter(Boolean);
/* A --hold child of `file` (this test, or a mutated copy of it) on `tree`'s harness. Its stdin is the pipe spawn()
   makes, which only the process that spawned it holds. */
function spawnHold(file, tree, env) {
  const p = spawn(process.execPath, [file, '--hold', tree], { cwd: tree, env });
  const c = { p, out: '' };
  p.stdout.on('data', (x) => { c.out += x; });
  p.stderr.on('data', (x) => { c.out += x; });
  c.done = new Promise((res) => p.on('close', (code, signal) => res({ code, signal })));
  return c;
}

/* --hold <tree>: a child of section 0. It opens one D1 from that tree's harness, says so, and waits for a signal,
   or for the process that started it to go. T5-V3 (16 Nov 2026): a parent that died between this child's HOLD and
   its own signal to it (a SIGTERM that gates.js passes on to usage-d1 lands there) left this child, and its
   workerd, running with PPID 1 on a port of the band, for good: nothing more was ever written to it, so it never
   met an EPIPE. So its stdin, a pipe only that parent holds, is its tether: the OS closes it however the parent
   ends (a SIGKILL included), and the child then exits, and its 'exit' disposes workerd. The tether is set before
   the D1 opens, so a parent lost during init is noticed as soon as init answers. */
async function hold(tree) {
  process.stdin.on('end', () => process.exit(0)); process.stdin.on('error', () => process.exit(0)); process.stdin.resume();
  const mf = await import(pathToFileURL(path.join(tree, 'workers', 'admin', 'dev', 'd1-miniflare.mjs')).href);
  const d = mf.makeD1({ shadow: false }, { makeSqliteD1: null, norm: null });
  const row = await d.prepare('SELECT 41 + 1 AS n').first();
  console.log('HOLD ' + JSON.stringify({ n: row ? row.n : null }));
  setInterval(() => {}, 1000);
}
/* --hold-parent <tree> <file>: a child of section 0 that starts a --hold child of `file` exactly as signalCheck
   does, says HOLDING with its pid and its workerd's once that child holds its D1, and then waits to be killed. */
async function holdParent(tree, file) {
  const c = spawnHold(file, tree, process.env);
  const held = await until(() => /^HOLD /m.test(c.out) || c.p.exitCode !== null, 90000);
  console.log('HOLDING ' + JSON.stringify({ child: c.p.pid, workerd: childrenOf(c.p.pid), out: held && /^HOLD \{"n":42\}/m.test(c.out) ? undefined : c.out.slice(-400) }));
  setInterval(() => {}, 1000);
}
/* SD2-V1 (16 Nov 2026): Miniflare runs workerd from a worker thread, and Node gives a worker thread no signals,
   so a SIGTERM sent to the test's own pid (a harness timeout's kill(), `timeout`, a session stopping a background
   run) left workerd running with PPID 1, holding its port, for good. A child holds a D1 from `tree`'s harness on
   `port`, is sent `sig` alone, and then its workerd (found as its child process) must be gone and nothing may
   listen on `port`. Whatever a red run leaves is killed here. */
async function signalCheck(tree, mfi, port, sig) {
  const c = spawnHold(path.join(ROOT, 'test', 'usage-d1-engine.test.js'), tree, childD1Env(mfi, port));
  const p = c.p;
  const held = await until(() => /^HOLD /m.test(c.out) || p.exitCode !== null, 90000);
  const m = /^HOLD (.*)$/m.exec(c.out);
  const n = m ? JSON.parse(m[1]).n : null;
  const kids = childrenOf(p.pid);
  const before = await listeningOn(port);
  try { p.kill(sig); } catch (e) { /* already gone */ }
  const r = await Promise.race([c.done, new Promise((res) => setTimeout(() => res({ code: null, signal: 'still running after 30 s' }), 30000))]);
  const gone = await until(() => !kids.some(alive), 5000);
  const free = await until(async () => !(await listeningOn(port)), 5000);
  const left = kids.filter(alive);
  left.forEach((k) => { try { process.kill(k, 'SIGKILL'); } catch (e) { /* gone */ } });
  if (p.exitCode === null && p.signalCode === null) { try { p.kill('SIGKILL'); } catch (e) { /* gone */ } }
  return { held: held && n === 42, before, kids, died: r.signal || ('exit ' + r.code), gone, free, left, out: n === 42 ? undefined : c.out.slice(-400) };
}
/* T5-V3: a --hold child of `file` is started by a --hold-parent, and that parent is SIGKILLed once the child holds
   its D1 (nothing can be told then). The child and its workerd must then be gone, and nothing may listen on
   `port`. Whatever a red run leaves is killed here. */
async function tetherCheck(tree, mfi, port, file) {
  const p = spawn(process.execPath, [path.join(ROOT, 'test', 'usage-d1-engine.test.js'), '--hold-parent', tree, file], { cwd: tree, env: childD1Env(mfi, port) });
  let out = '';
  p.stdout.on('data', (x) => { out += x; });
  p.stderr.on('data', (x) => { out += x; });
  const said = await until(() => /^HOLDING /m.test(out) || p.exitCode !== null, 120000);
  const m = /^HOLDING (.*)$/m.exec(out);
  const h = m ? JSON.parse(m[1]) : {};
  const child = h.child || 0, workerd = h.workerd || [];
  const before = await listeningOn(port);
  try { p.kill('SIGKILL'); } catch (e) { /* already gone */ }
  const gone = await until(() => !alive(child) && !workerd.some(alive), 10000);
  const free = await until(async () => !(await listeningOn(port)), 5000);
  const left = [child].concat(workerd).filter(alive);
  left.forEach((k) => { try { process.kill(k, 'SIGKILL'); } catch (e) { /* gone */ } });
  return { held: said && !!child && workerd.length >= 1 && !h.out, before, child, workerd, gone, free, left, out: h.out || (m ? undefined : out.slice(-400)) };
}
async function osPort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => res(q)); }); });
}

function copyTree(dst) {
  for (const f of ['worker.js', 'wrangler.toml']) fs.copyFileSync(path.join(ROOT, f), path.join(dst, f));
  fs.cpSync(path.join(ROOT, 'schema'), path.join(dst, 'schema'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'workers'), path.join(dst, 'workers'), { recursive: true, filter: (s) => !/node_modules/.test(s) });
}

if (PROBE) probe(PROBE).then(() => process.exit(0), (e) => { console.log('PROBE-ERROR ' + String((e && e.stack) || e)); process.exit(1); });
else if (HOLD) hold(HOLD).catch((e) => { console.log('HOLD-ERROR ' + String((e && e.stack) || e)); process.exit(1); });
else if (HOLD_PARENT) holdParent(HOLD_PARENT[0], HOLD_PARENT[1]).catch((e) => { console.log('HOLDING-ERROR ' + String((e && e.stack) || e)); process.exit(1); });
else (async () => {
  const t0 = Date.now();
  console.log('\nusage-d1: the usage SQL on workerd\'s own D1 (Miniflare), against the shim\n');
  const eng = await engines(ROOT);
  const mfi = eng.mf.findMiniflare(ROOT);   // throws, with what to do, if it is not there
  const ports = await pickPorts(3);
  process.env.CUBBY_D1_PORT = String(ports[0]);
  console.log('  miniflare ' + mfi.version + ' (workerd ' + mfi.workerd + ') from ' + mfi.dir.replace(os.homedir(), '~'));
  console.log('  ports: this process ' + (ports[0] || 'any free') + ', the suites ' + ports.slice(1).map((p) => p || 'any free').join(' and '));
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + stable(x).slice(0, 600) : '')); } };

  console.log('\n0. the harness: the pinned Miniflare, and nothing beyond loopback');
  ok('this run is on the pinned miniflare ' + eng.mf.MINIFLARE_PIN + ' (another build can run with MINIFLARE_ANY_VERSION=1, never pass)', mfi.pinned === true && mfi.version === eng.mf.MINIFLARE_PIN, mfi);
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-usage-d1-fakemf-'));
  try {
    fs.writeFileSync(path.join(fake, 'package.json'), JSON.stringify({ name: 'miniflare', version: '0.0.0-unpinned' }));
    const find = (dir, any) => {
      const was = { p: process.env.MINIFLARE_PATH, a: process.env.MINIFLARE_ANY_VERSION };
      process.env.MINIFLARE_PATH = dir;
      if (any) process.env.MINIFLARE_ANY_VERSION = '1'; else delete process.env.MINIFLARE_ANY_VERSION;
      try { return eng.mf.findMiniflare(ROOT); } catch (e) { return { error: String(e.message || e) }; } finally {
        if (was.p === undefined) delete process.env.MINIFLARE_PATH; else process.env.MINIFLARE_PATH = was.p;
        if (was.a === undefined) delete process.env.MINIFLARE_ANY_VERSION; else process.env.MINIFLARE_ANY_VERSION = was.a;
      }
    };
    const other = find(fake, false), meant = find(fake, true), pinned = find(mfi.dir, false);
    ok('MINIFLARE_PATH at another miniflare build is refused, and the refusal names the pin', !!other.error && other.error.includes('0.0.0-unpinned') && other.error.includes(eng.mf.MINIFLARE_PIN), other);
    ok('unless MINIFLARE_ANY_VERSION=1 says it is meant (and then it is marked unpinned)', meant.version === '0.0.0-unpinned' && meant.pinned === false, meant);
    ok('companion: MINIFLARE_PATH at the pinned build is taken', pinned.version === eng.mf.MINIFLARE_PIN && pinned.pinned === true, pinned);
  } finally { fs.rmSync(fake, { recursive: true, force: true }); }
  const holdPort = ports[1] || await osPort();
  /* This list is the test's own, not the harness's SIGNALS: a signal dropped there must turn its line here red.
     SIGALRM is nightly.sh's watchdog (perl's alarm, then exec), so a D1 holder run directly under it gets one. */
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGALRM']) {
    const r = await signalCheck(ROOT, mfi, holdPort, sig);
    ok('companion (' + sig + '): the child held a D1 whose workerd, its own child process, listened on :' + holdPort, r.held && r.before && r.kids.length >= 1, r);
    ok(sig + ' to that process alone: it still dies of ' + sig + ', its workerd is gone, and nothing listens on :' + holdPort,
      r.died === sig && r.gone && r.free, r);
  }
  {
    const r = await tetherCheck(ROOT, mfi, holdPort, path.join(ROOT, 'test', 'usage-d1-engine.test.js'));
    ok('companion (parent lost): a --hold child, started as these checks start one, held a D1 whose workerd listened on :' + holdPort, r.held && r.before, r);
    ok('its parent SIGKILLed once it holds (where a SIGTERM passed on by gates.js can land): the child and its workerd are gone, nothing listens on :' + holdPort,
      r.gone && r.free, r);
  }

  console.log('\n1-3. engine facts, the real code paths on both engines, and D1\'s meter');
  const both = await bothEngines(ROOT, eng, false);
  ok('the checks pass on D1 (' + both.d1.pass + ' of ' + (both.d1.pass + both.d1.fail) + ')', both.d1.fail === 0, both.d1.failed);
  ok('the same checks pass on the shim (' + both.sq.pass + ' of ' + (both.sq.pass + both.sq.fail) + ')', both.sq.fail === 0, both.sq.failed);
  ok('D1 answered every recorded step exactly as the shim did (' + both.sq.trace.size + ' answers and table dumps)', both.differ.length === 0 && both.sq.trace.size >= 20, both.differ);
  const f = both.d1.facts;
  console.log('       D1 measured: ' + stable({ triggerChanges: f.triggerChanges, maxParams: f.maxParams, maxSqlBytes: f.maxSqlBytes, deletePerRow: f.deletePerRow, membership: f.membershipWrites, worstDay: f.worstDay }));

  if (!SUITES_OFF) {
    console.log('\n4. the usage suites, unchanged, on D1 with every statement shadowed on node:sqlite');
    await suitesOnD1(ok, ports.slice(1));
  }

  if (SELF) {
    console.log('\nself-test: each break, in a temp copy of the tree; a D1-only break must be red on D1 and green on the shim');
    const comparatorDb = eng.mf.makeD1({ shadow: true }, { makeSqliteD1: (await imp(ROOT, 'workers/admin/dev/d1-sqlite.mjs')).makeSqliteD1, norm: (await imp(ROOT, 'workers/admin/dev/d1-sqlite.mjs')).norm });
    const m0 = eng.mf.engineStats.mismatchCount;
    try { await comparatorDb.prepare('SELECT ? AS a').bind(undefined).all(); } catch (e) { /* D1 refuses it; the shim answers NULL */ }
    ok('the shadow comparison catches a statement D1 answers differently (a bound undefined)', eng.mf.engineStats.mismatchCount === m0 + 1, eng.mf.engineStats.mismatches.slice(-1));
    const v1 = verdict('x\n96 passed, 0 failed\nUSAGE-INGEST: PASS\n'), v2 = verdict('95 passed, 1 failed\nUSAGE-INGEST: FAIL\n'), v3 = verdict('USAGE-INGEST: PASS\n');
    ok('the suite verdict reader tells a pass, a fail and a missing count apart', v1.pass && v1.passed === 96 && !v2.pass && v2.failed === 1 && v3.passed === null);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-usage-d1-self-'));
    try {
      copyTree(tmp);
      const clean = await bothEngines(tmp, eng, true);
      ok('an unaltered copy passes on both engines (' + clean.d1.pass + ' and ' + clean.sq.pass + ' checks)', clean.d1.fail === 0 && clean.sq.fail === 0 && clean.differ.length === 0, { d1: clean.d1.failed, sq: clean.sq.failed, differ: clean.differ });
      for (const m of MUTANTS) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-usage-d1-mut-'));
        try {
          copyTree(dir);
          const file = path.join(dir, m.file);
          const src = fs.readFileSync(file, 'utf8');
          const at = src.indexOf(m.find);
          if (at < 0 || src.indexOf(m.find, at + 1) >= 0) { ok('anchor present and unique for: ' + m.name, false); continue; }
          fs.writeFileSync(file, src.slice(0, at) + m.put + src.slice(at + m.find.length));
          const r = await bothEngines(dir, eng, true);
          const red = r.d1.fail > 0;
          if (m.d1Only) ok('caught on D1 only: ' + m.name + ' (D1 ' + r.d1.fail + ' red, shim ' + r.sq.fail + ' red)', red && r.sq.fail === 0, { d1: r.d1.failed, sq: r.sq.failed });
          else ok('caught: ' + m.name + ' (' + r.d1.fail + ' red on D1)', red, r.d1.failed);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
      }
      /* The harness itself, in a fresh process each: the copy as it is, then started without `cf: false`. */
      const cleanProbe = await probeTree(tmp, mfi, ports[1]);
      ok('the offline probe on an unaltered copy: D1 answers, and no socket beyond loopback', cleanProbe.n === 42 && Array.isArray(cleanProbe.outbound) && cleanProbe.outbound.length === 0, cleanProbe);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-usage-d1-mut-'));
      try {
        copyTree(dir);
        const file = path.join(dir, OFFLINE_MUTANT.file);
        const src = fs.readFileSync(file, 'utf8');
        const at = src.indexOf(OFFLINE_MUTANT.find);
        if (at < 0 || src.indexOf(OFFLINE_MUTANT.find, at + 1) >= 0) ok('anchor present and unique for: ' + OFFLINE_MUTANT.name, false);
        else {
          fs.writeFileSync(file, src.slice(0, at) + OFFLINE_MUTANT.put + src.slice(at + OFFLINE_MUTANT.find.length));
          const r = await probeTree(dir, mfi, ports[1]);
          ok('caught: ' + OFFLINE_MUTANT.name + ' reaches for workers.cloudflare.com, refused before DNS (' + stable(r.outbound) + ')',
            r.n === 42 && Array.isArray(r.outbound) && r.outbound.some((o) => /^workers\.cloudflare\.com:/.test(o)), r);
        }
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
      const sdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-usage-d1-mut-'));
      try {
        copyTree(sdir);
        const file = path.join(sdir, SIGNAL_MUTANT.file);
        const src = fs.readFileSync(file, 'utf8');
        const at = src.indexOf(SIGNAL_MUTANT.find);
        if (at < 0 || src.indexOf(SIGNAL_MUTANT.find, at + 1) >= 0) ok('anchor present and unique for: ' + SIGNAL_MUTANT.name, false);
        else {
          fs.writeFileSync(file, src.slice(0, at) + SIGNAL_MUTANT.put + src.slice(at + SIGNAL_MUTANT.find.length));
          const r = await signalCheck(sdir, mfi, ports[1] || await osPort(), 'SIGTERM');
          ok('caught: ' + SIGNAL_MUTANT.name + ' leaves workerd running after a SIGTERM (killed here: ' + stable(r.left) + ')', r.held && r.died === 'SIGTERM' && !r.gone && r.left.length >= 1, r);
        }
      } finally { fs.rmSync(sdir, { recursive: true, force: true }); }
      const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-usage-d1-mut-'));
      try {
        const src = fs.readFileSync(path.join(ROOT, TETHER_MUTANT.file), 'utf8');
        const at = src.indexOf(TETHER_MUTANT.find);
        if (at < 0 || src.indexOf(TETHER_MUTANT.find, at + 1) >= 0) ok('anchor present and unique for: ' + TETHER_MUTANT.name, false);
        else {
          const file = path.join(tdir, path.basename(TETHER_MUTANT.file));
          fs.writeFileSync(file, src.slice(0, at) + TETHER_MUTANT.put + src.slice(at + TETHER_MUTANT.find.length));
          const r = await tetherCheck(ROOT, mfi, ports[1] || await osPort(), file);
          ok('caught: ' + TETHER_MUTANT.name + ' outlives its SIGKILLed parent, its workerd with it (killed here: ' + stable(r.left) + ')', r.held && !r.gone && r.left.length >= 2, r);
        }
      } finally { fs.rmSync(tdir, { recursive: true, force: true }); }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  const reached = eng.mf.outboundAttempts();
  ok('Miniflare\'s thread in this process opened no socket beyond loopback (' + eng.mf.engineStats.dbs + ' databases)', Array.isArray(reached) && reached.length === 0, reached);

  console.log('\n' + pass + ' passed, ' + fail + ' failed (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  console.log('USAGE-D1' + (SELF ? ' (with self-test)' : '') + ': ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('USAGE-D1: FAIL\n' + (e && e.stack || e)); process.exit(1); });
