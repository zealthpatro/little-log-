/* usage-ingest: what POST /api/usage may store, run through the real ingest() over real SQLite.
 *
 *   node test/usage-ingest.test.js
 *   node test/usage-ingest.test.js --self-test   (break each rule in a temp copy of core.mjs; each must be caught)
 *
 * Spec §8.2 to §8.8 and §14 (usage-ingest). Each section stages the thing that must NOT be stored and
 * proves it is not, and a companion proves the same query finds a row when one IS stored, so no check
 * here is green for free. The clock is pinned to a day AND an hour (23:30 UTC on 15 Nov 2026, which is
 * 03:30 on 16 Nov in Dubai), so the local-day rule is tested across a date line, and the next UTC day
 * starts an hour later (sections 14 and 15 use that). Sections 15 and 16 check that what ingest's path
 * leaves behind (the day counters, a membership row's household, refusal counts) goes with its day or its
 * household. The route itself (body size, limiter keys, membership, log lines) is test/usage-route.test.js.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const SELF = process.argv.includes('--self-test');
const CORE = path.join(ROOT, 'workers', 'usage', 'core.mjs');

async function suite(coreFile, quiet) {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; } else { fail++; if (!quiet) console.log('  FAIL ' + n + (x !== undefined ? '\n       ' + JSON.stringify(x).slice(0, 500) : '')); } };
  let core;
  try { core = await import('file://' + coreFile + '?' + Math.random()); }
  catch (e) { return { pass, fail, loadError: String(e && e.message || e) }; }
  const { makeD1 } = await import('file://' + path.join(ROOT, 'workers', 'admin', 'dev', 'd1-sqlite.mjs'));
  const schema = fs.readFileSync(path.join(ROOT, 'schema', 'usage.sql'), 'utf8');
  const NOW = Date.UTC(2026, 10, 15, 23, 30, 0);
  const ME = 'founderUid000000000000000001', THEM = 'familyUid0000000000000000002';
  let n = 0;
  const uuid = () => { n++; const h = n.toString(16).padStart(12, '0'); return '6f1c0b8e-0000-4000-8000-' + h; };
  const ev = (name, props, extra) => Object.assign({ id: uuid(), t: NOW - 60000, visit: 'v_abcd1234', name, props }, extra || {});
  const body = (events, extra) => Object.assign({ v: 1, tz: 'Asia/Dubai', device: 'd_k3j9x2m7q1aa', platform: 'ios_app', app_version: 'v368', native_version: '2026.46.2', events }, extra || {});
  const fresh = () => { const db = makeD1(); db.raw.exec(schema); return db; };
  const logs = [];
  const ctxOf = (db, over) => Object.assign({
    db, env: { USAGE_MODE: 'internal', INTERNAL_UIDS: ME }, uid: ME, now: NOW, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    membership: async () => ({ hid: 'hhFounder01', role: 'owner', notice: '' }), notice: '', log: (code) => logs.push(code),
  }, over || {});
  const rows = (db, sql) => db.raw.prepare(sql).all();
  const total = (db, t) => rows(db, 'SELECT COUNT(*) AS c FROM ' + t)[0].c;

  if (!quiet) console.log('\nusage-ingest\n');
  try {
  // 1. A good batch is stored with server-side who, household, local time and coarse device.
  {
    const db = fresh();
    const r = await core.ingest(body([ev('visit.started', { opened_from: 'icon', start: 'cold' }), ev('screen.viewed', { screen: 'home' }),
      ev('feature.used', { feature: 'feed', action: 'logged' })]), ctxOf(db));
    const st = rows(db, 'SELECT * FROM usage_events ORDER BY name');
    ok('a good batch is accepted', r.status === 200 && r.body.accepted === 3, r);
    ok('every row carries the verified uid and the server-stamped household', st.length === 3 && st.every((x) => x.uid === ME && x.hid === 'hhFounder01' && x.role === 'owner'), st);
    ok("local day and hour are the family's own (03:30 on the 16th in Dubai)", st[0].local_day === '2026-11-16' && st[0].local_hour === 3, st[0]);
    ok('os and browser are coarse, and the raw user agent is not stored', st[0].os === 'iOS 27.0' && !JSON.stringify(st).includes('Mozilla'), st[0]);
    ok('props are canonical JSON with sorted keys', st.find((x) => x.name === 'feature.used').props === '{"action":"logged","feature":"feed"}');
    const daily = rows(db, 'SELECT metric, key, n, uid, hid FROM usage_daily ORDER BY metric');
    ok('daily totals count the visit, the screen and the feature for this person', daily.length === 3 && daily.every((d) => d.uid === ME && d.hid === 'hhFounder01'), daily);
    // 2. A retry of the same ids stores nothing new and counts nothing twice.
    const again = await core.ingest(body(rows(db, 'SELECT id, client_at AS t, visit, name, props FROM usage_events').map((x) => ({ id: x.id, t: x.t, visit: x.visit, name: x.name, props: JSON.parse(x.props) }))), ctxOf(db));
    ok('a retried batch is answered, and adds no rows', again.body.accepted === 0 && total(db, 'usage_events') === 3, again);
    ok('and adds nothing to the daily totals', rows(db, 'SELECT SUM(n) AS s FROM usage_daily')[0].s === 3);
  }

  // 3. Who and which household come from the server only.
  for (const k of ['uid', 'hid', 'role', 'householdId', 'userId']) {
    const db = fresh();
    const r = await core.ingest(body([ev('screen.viewed', { screen: 'home' })], { [k]: 'forged' }), ctxOf(db));
    ok('a body naming ' + k + ' is refused whole (400) and nothing is stored', r.status === 400 && total(db, 'usage_events') === 0, r);
  }

  // 3b. At most 50 events a batch (§8.7, S27). A 51st refuses the whole batch; 50 is the companion.
  {
    const db = fresh();
    const many = (k) => Array.from({ length: k }, () => ev('screen.viewed', { screen: 'home' }));
    const big = await core.ingest(body(many(51)), ctxOf(db));
    ok('a batch of 51 events is refused whole (400) and nothing is stored', big.status === 400 && total(db, 'usage_events') === 0 && total(db, 'devices') === 0, big);
    const fifty = await core.ingest(body(many(50)), ctxOf(db));
    ok('companion: a batch of 50 is accepted and all 50 are stored', fifty.status === 200 && fifty.body.accepted === 50 && total(db, 'usage_events') === 50, fifty);
  }

  // 4. Nothing that could carry content is stored: unknown events, unknown props, free strings, bad ids.
  {
    const db = fresh();
    const bad = [
      ev('feed.logged', { amount: 120 }),                                         // not an event
      ev('feature.used', { feature: 'feed', action: 'logged', amount_ml: 120 }),  // an extra property
      ev('feature.used', { feature: 'Calpol 5ml', action: 'logged' }),           // a free string
      ev('screen.viewed', { screen: 'mood' }),                                     // a never-instrumented place
      ev('visit.ended', { seconds: 999999, reason: 'hidden' }),                    // out of bounds
      ev('screen.viewed', { screen: 'home' }, { id: 'not-a-uuid' }),
      ev('screen.viewed', { screen: 'home' }, { id: '6f1c0b8e-0000-1000-8000-000000000999' }),  // v1, not v4
      ev('screen.viewed', { screen: 'home' }, { visit: 'v_Maya' }),
    ];
    const r = await core.ingest(body(bad), ctxOf(db));
    ok('every event that could carry content is refused', r.body.accepted === 0 && r.body.refused === bad.length, r);
    ok('none of them reached the events table', total(db, 'usage_events') === 0);
    const dump = db.dump();
    ok('their content is stored nowhere, not even in the refusal counts', !/Calpol|Maya|amount|999999/.test(dump), dump.slice(0, 400));
    const reasons = rows(db, 'SELECT reason, n FROM usage_refused ORDER BY reason');
    ok('refusals are counted by fixed reason only', reasons.length > 0 && reasons.every((x) => core.REFUSED.includes(x.reason)), reasons);
    // Companion: the same table DOES get a row when a good event arrives, so "0 rows" above means something.
    await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(db));
    ok('companion: a good event in the same database is stored', total(db, 'usage_events') === 1);
  }

  // 5. A native version with words in it is stored as null, never as sent.
  {
    const db = fresh();
    await core.ingest(body([ev('screen.viewed', { screen: 'home' })], { native_version: '1.4 Maya' }), ctxOf(db));
    const st = rows(db, 'SELECT native_version FROM usage_events');
    ok('native_version "1.4 Maya" is stored as null', st.length === 1 && st[0].native_version === null, st);
    ok('and no device row keeps it either', !db.dump().includes('Maya'));
    await core.ingest(body([ev('screen.viewed', { screen: 'home' })], { native_version: '1.4.2' }), ctxOf(db));
    ok('companion: a plain dotted native version is kept', rows(db, "SELECT COUNT(*) AS c FROM usage_events WHERE native_version = '1.4.2'")[0].c === 1);
  }

  // 6. One id from two people is two rows: a client cannot claim an id another person will send.
  {
    const db = fresh();
    const shared = '6f1c0b8e-0000-4000-8000-0000000abcde';
    const env = { USAGE_MODE: 'on', INTERNAL_UIDS: ME };
    const mem = async () => ({ hid: 'h1', role: 'owner', notice: 'n1' });
    await core.ingest(body([ev('screen.viewed', { screen: 'home' }, { id: shared })]), ctxOf(db, { env, membership: mem, notice: 'n1' }));
    await core.ingest(body([ev('screen.viewed', { screen: 'home' }, { id: shared })]), ctxOf(db, { env, uid: THEM, membership: mem, notice: 'n1' }));
    ok('the same id from two people is stored for both', total(db, 'usage_events') === 2);
  }

  // 7. The switch. off stores nothing; internal stores only INTERNAL_UIDS; nobody before sign-in until on.
  {
    const db = fresh();
    const off = await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(db, { env: { USAGE_MODE: 'off', INTERNAL_UIDS: ME } }));
    ok('mode off answers off and stores nothing', off.body.mode === 'off' && total(db, 'usage_events') === 0, off);
    const unset = await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(db, { env: {} }));
    ok('an unset mode is off', unset.body.mode === 'off' && total(db, 'usage_events') === 0);
    const fam = await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(db, { uid: THEM }));
    ok('mode internal stores nothing for a family', fam.body.mode === 'off' && total(db, 'usage_events') === 0, fam);
    const anon = await core.ingest(body([ev('screen.viewed', { screen: 'signin' })]), ctxOf(db, { uid: null }));
    ok('mode internal stores nothing before sign-in', total(db, 'usage_events') === 0, anon);
    ok('and answers off to a request with no sign-in, so the phone sends nothing anonymously (§8.8)', anon.body.mode === 'off', anon);
    const nodb = await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(null));
    ok('no database bound answers off', nodb.body.mode === 'off');
    await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(db));
    ok('companion: mode internal stores the founder', rows(db, 'SELECT uid FROM usage_events').map((x) => x.uid).join() === ME);
  }

  // 8. Mode on: a linked event waits for the current notice.
  {
    const db = fresh();
    const env = { USAGE_MODE: 'on' };
    const unseen = await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(db, { env, uid: THEM, notice: 'n2', membership: async () => ({ hid: 'h2', role: 'caregiver', notice: 'n1' }) }));
    ok('in mode on, a person who has not seen the current notice is not stored', unseen.body.accepted === 0 && total(db, 'usage_events') === 0, unseen);
    ok('and it is counted as notice', (rows(db, "SELECT n FROM usage_refused WHERE reason = 'notice'")[0] || {}).n === 1);
    /* G4 for a NON-empty batch (8b covers the empty ask): nothing anywhere links her to this phone. */
    ok('and no device row, nor any row in any table, carries her uid or her device', !db.dump().includes(THEM) && !db.dump().includes('d_k3j9x2m7q1aa') && total(db, 'devices') === 0, db.dump().slice(0, 400));
    const none = await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(db, { env, uid: THEM, notice: '', membership: async () => ({ hid: 'h2', role: 'caregiver', notice: '' }) }));
    ok('with no notice published at all, nobody linked is stored', none.body.accepted === 0);
    const seen = await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(db, { env, uid: THEM, notice: 'n2', membership: async () => ({ hid: 'h2', role: 'caregiver', notice: 'n2' }) }));
    ok('companion: once the current notice is seen, the event is stored', seen.body.accepted === 1, seen);
    ok('companion: and the same dump now finds her uid and her device row', db.dump().includes(THEM) && total(db, 'devices') === 1);
    const anon = await core.ingest(body([ev('signin.attempted', { method: 'email_code', step: 'started', outcome: 'failed', error: 'wrong_code', attempt: 2, storage: 'app' }), ev('feature.used', { feature: 'feed', action: 'logged' })]), ctxOf(db, { env, uid: null }));
    ok('in mode on, before sign-in only the allowed events are stored, with no uid', anon.body.accepted === 1 && rows(db, "SELECT uid, who FROM usage_events WHERE name = 'signin.attempted'").every((x) => x.uid === null && x.who === 'anon_d_k3j9x2m7q1aa'), anon);
  }

  // 8a. Before sign-in, screen.viewed is allowed only for the sign-in and landing screens (§8.3).
  {
    const db = fresh();
    const env = { USAGE_MODE: 'on' };
    const r = await core.ingest(body([ev('screen.viewed', { screen: 'home' }), ev('screen.viewed', { screen: 'log_medicine' })]), ctxOf(db, { env, uid: null }));
    ok('in mode on, an anonymous screen.viewed for home or log_medicine is refused and not stored', r.body.accepted === 0 && total(db, 'usage_events') === 0, r);
    ok('and counted as anon_not_allowed', (rows(db, "SELECT n FROM usage_refused WHERE reason = 'anon_not_allowed'")[0] || {}).n === 2);
    const c = await core.ingest(body([ev('screen.viewed', { screen: 'signin' }), ev('screen.viewed', { screen: 'landing' })]), ctxOf(db, { env, uid: null }));
    ok('companion: signin and landing are stored before sign-in', c.body.accepted === 2 && rows(db, "SELECT COUNT(*) AS c FROM usage_events WHERE uid IS NULL AND name = 'screen.viewed'")[0].c === 2, c);
  }

  // 8b. The tracker's daily ask is an EMPTY batch. It writes nothing anywhere: no device row links a
  //     person to this phone before she has seen the notice (G4), in any mode.
  {
    const db = fresh();
    const env = { USAGE_MODE: 'on' };
    const unseenMem = async () => ({ hid: 'h2', role: 'caregiver', notice: 'n1' });
    const ask = await core.ingest(body([]), ctxOf(db, { env, uid: THEM, notice: 'n2', membership: unseenMem }));
    ok('mode on, notice not seen: the empty ask is answered on', ask.status === 200 && ask.body.mode === 'on', ask);
    ok('and leaves no device row: nothing links her before she has seen the notice', total(db, 'devices') === 0, rows(db, 'SELECT * FROM devices'));
    await core.ingest(body([]), ctxOf(db));                                                    // the founder, internal
    await core.ingest(body([]), ctxOf(db, { env, uid: null }));                                // before sign-in, mode on
    const tables = rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    const written = tables.filter((t) => total(db, t) > 0);
    ok('an empty ask writes no row in any table, signed in or not', written.length === 0, written);
    // Companion: the same query finds her device row once an event is stored after she has seen it.
    await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(db, { env, uid: THEM, notice: 'n2', membership: async () => ({ hid: 'h2', role: 'caregiver', notice: 'n2' }) }));
    ok('companion: a stored event does write her device row', rows(db, 'SELECT uid FROM devices').map((x) => x.uid).join() === THEM, rows(db, 'SELECT uid FROM devices'));
  }

  // 8c. The device row keeps this phone's notification answer (the admin's Devices "Reminders" column).
  //     The newest answer wins; a bare 'asked' never replaces an answer, so a late retry cannot undo one.
  {
    const db = fresh();
    const push = () => rows(db, 'SELECT push FROM devices').map((x) => x.push);
    await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(db));
    ok('a device with no notification event has no answer recorded', push().length === 1 && push()[0] === null, push());
    await core.ingest(body([ev('push.permission', { state: 'asked' }, { t: NOW - 50000 }), ev('push.permission', { state: 'granted' }, { t: NOW - 50000 })]), ctxOf(db));
    ok('asked and granted in one batch at the same moment: granted is kept', push().join() === 'granted', push());
    await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(db));
    ok('a later batch with no notification event leaves the answer alone', push().join() === 'granted', push());
    await core.ingest(body([ev('push.permission', { state: 'denied' }, { t: NOW - 40000 })]), ctxOf(db));
    ok('a newer answer replaces the old one', push().join() === 'denied', push());
    await core.ingest(body([ev('push.permission', { state: 'asked' }, { t: NOW - 55000 })]), ctxOf(db));
    ok('a late asked (an older batch retried) never turns an answer back into asked', push().join() === 'denied', push());
    const other = body([ev('push.permission', { state: 'asked' })], { device: 'd_zz9x2m7q1abb' });
    await core.ingest(other, ctxOf(db));
    ok('companion: a phone that was only asked reads asked', rows(db, "SELECT push FROM devices WHERE device = 'd_zz9x2m7q1abb'").map((x) => x.push).join() === 'asked', rows(db, 'SELECT device, push FROM devices'));
  }

  // 9. Pregnancy-only places never reach a per-person daily row.
  {
    const db = fresh();
    await core.ingest(body([ev('screen.viewed', { screen: 'kicks' }), ev('feature.used', { feature: 'contractions', action: 'opened' }), ev('screen.viewed', { screen: 'home' })]), ctxOf(db));
    const per = rows(db, "SELECT key FROM usage_daily WHERE uid != '' AND key IN ('kicks','contractions','pregnancy_week','cycle')");
    ok('JOURNEY_KEYS reach no per-person daily row', per.length === 0, per);
    const agg = rows(db, "SELECT key, hid FROM usage_daily WHERE uid = '' ORDER BY key");
    ok('they are counted only in aggregate rows with no household', agg.length === 2 && agg.every((x) => x.hid === ''), agg);
    ok('companion: an ordinary screen does get a per-person row', rows(db, "SELECT COUNT(*) AS c FROM usage_daily WHERE key = 'home' AND uid != ''")[0].c === 1);
  }

  // 10. The day ceiling.
  {
    const db = fresh();
    const r1 = await core.ingest(body([ev('screen.viewed', { screen: 'home' }), ev('screen.viewed', { screen: 'timeline' })]), ctxOf(db, { env: { USAGE_MODE: 'internal', INTERNAL_UIDS: ME, USAGE_DAILY_CAP: '3' } }));
    const r2 = await core.ingest(body([ev('screen.viewed', { screen: 'home' }), ev('screen.viewed', { screen: 'home' })]), ctxOf(db, { env: { USAGE_MODE: 'internal', INTERNAL_UIDS: ME, USAGE_DAILY_CAP: '3' } }));
    ok('under the ceiling, events are stored', r1.body.accepted === 2, r1);
    ok('a batch that would pass the ceiling is not stored', r2.body.accepted === 0 && total(db, 'usage_events') === 2, r2);
    ok('and is counted as ceiling', (rows(db, "SELECT n FROM usage_refused WHERE reason = 'ceiling'")[0] || {}).n === 2);
  }

  // 10b. Batches with no sign-in have their OWN ceiling (§8.7, W2): a quarter of USAGE_DAILY_CAP, so a
  //      script with no token can never use up the families' day, and families never use up its quarter.
  {
    const env = { USAGE_MODE: 'on', USAGE_DAILY_CAP: '8' };                     // 2 for no sign-in, 6 for families
    const fam = (db) => ctxOf(db, { env, uid: THEM, notice: 'n2', membership: async () => ({ hid: 'h2', role: 'caregiver', notice: 'n2' }) });
    const visit = () => ev('visit.started', { opened_from: 'link', start: 'cold' });
    const db = fresh();
    const a = [];
    for (let i = 0; i < 10; i++) a.push((await core.ingest(body([visit()]), ctxOf(db, { env, uid: null }))).body.accepted);
    ok('companion: past its quarter, a batch with no sign-in is refused (2 stored of 10)', a.join() === '1,1,0,0,0,0,0,0,0,0' && total(db, 'usage_events') === 2, a);
    const f = await core.ingest(body([ev('feature.used', { feature: 'feed', action: 'logged' })]), fam(db));
    ok('after batches with no sign-in fill their ceiling, a family who has seen the notice is still stored', f.body.accepted === 1 && rows(db, "SELECT COUNT(*) AS c FROM usage_events WHERE uid = '" + THEM + "'")[0].c === 1, f);
    const db2 = fresh();
    const g = [];
    for (let i = 0; i < 4; i++) g.push((await core.ingest(body([ev('feature.used', { feature: 'feed', action: 'logged' }), ev('screen.viewed', { screen: 'home' })]), fam(db2))).body.accepted);
    ok('companion: families fill their own share (6 of 8: 2+2+2, then refused)', g.join() === '2,2,2,0', g);
    const b = await core.ingest(body([visit()]), ctxOf(db2, { env, uid: null }));
    ok('and a full family share leaves the no-sign-in quarter untouched', b.body.accepted === 1, b);
    /* The FIRST batch of a day creates its counter, so the cap is never compared in SQL there: a first batch
       bigger than a whole share must still be refused (VI-4). */
    const db3 = fresh();
    const big = await core.ingest(body([visit(), visit(), visit()]), ctxOf(db3, { env, uid: null }));
    ok('a first batch of the day bigger than its whole share (3 of 2) stores nothing and starts no share counter', big.body.accepted === 0 && total(db3, 'usage_events') === 0
      && rows(db3, "SELECT key FROM usage_meta WHERE key NOT LIKE '%refused%'").length === 0, { big, meta: rows(db3, 'SELECT * FROM usage_meta') });
    const fits = await core.ingest(body([visit(), visit()]), ctxOf(db3, { env, uid: null }));
    ok('companion: a first batch that fills the share exactly (2 of 2) is stored', fits.body.accepted === 2 && total(db3, 'usage_events') === 2, fits);
  }

  // 11. Device time is clamped.
  {
    const db = fresh();
    await core.ingest(body([ev('screen.viewed', { screen: 'home' }, { t: NOW + 86400000 * 30 }), ev('screen.viewed', { screen: 'home' }, { t: 0 })]), ctxOf(db));
    const t = rows(db, 'SELECT client_at FROM usage_events ORDER BY client_at').map((x) => x.client_at);
    ok('device time is clamped to 7 days before and 5 minutes after receipt', t[0] === NOW - 7 * 86400000 && t[1] === NOW + 5 * 60000, t);
  }

  // 12. Nothing personal in a log line.
  {
    const db = fresh();
    db.raw.exec('DROP TABLE usage_events');
    logs.length = 0;
    const r = await core.ingest(body([ev('screen.viewed', { screen: 'home' })]), ctxOf(db));
    ok('a database failure never fails the request', r.status === 200, r);
    ok('it is logged as a code', logs.includes('usage_store_fail'), logs);
    ok('and no log line carries a uid', !logs.join(' ').includes(ME) && logs.every((l) => /^[a-z_]+$/.test(l)), logs);
    ok('companion: the same matcher finds a uid when a line carries one', ['usage_store_fail ' + ME].join(' ').includes(ME) && !/^[a-z_]+$/.test('usage_store_fail ' + ME));
  }

  // 13. The tracker's copy of the allowlist is exactly what core.mjs generates.
  {
    const file = path.join(ROOT, 'app', 'usage-allowlist.js');
    ok('app/usage-allowlist.js exists and equals core.allowlistSource()', fs.existsSync(file) && fs.readFileSync(file, 'utf8') === core.allowlistSource());
    const never = core.SCREENS.concat(core.FEATURES).filter((k) => core.NEVER_INSTRUMENTED.test(k));
    ok('no screen or feature is a never-instrumented place', never.length === 0, never);
    ok('companion: the never-instrumented matcher does catch one', core.NEVER_INSTRUMENTED.test('mood') && core.NEVER_INSTRUMENTED.test('loss_holding') && !core.NEVER_INSTRUMENTED.test('home'));
  }

  // 14. D1's daily write allowance (W1, §8.7). The Free plan gives the WHOLE account 100,000 rows written a
  //     day, shared with the games, the newsletter and the cron heartbeat, and D1 refuses every query once it
  //     is spent. So /api/usage must write a bounded number of rows a day however it is hammered.
  //
  //     Counted here: rows changed (inserted, updated or deleted, by a trigger on every table), and D1 calls
  //     (each first/run/all, each batch). This is NOT what D1 bills: D1 bills one more row for each index
  //     entry a write touches (an event row alone touches four in schema/usage.sql), so the billed figure
  //     is several times the rows changed counted here. Whether the cap keeps the BILLED day under half of
  //     100,000 is the cap's own sizing (finding W4: wrangler.toml's USAGE_DAILY_CAP comment and the
  //     billed-row arithmetic the erasure lane keeps beside it), not this section's. What this section
  //     proves is the bound that sizing multiplies: rows changed by /api/usage stop at a fixed number a
  //     day, however the route is hammered.
  //
  //     The stated daily maximum, in rows changed, at USAGE_DAILY_CAP as wrangler.toml sets it:
  //       4 x cap      each ceiling slot buys at most its event row, its daily total, and (worst case, one
  //                    event a batch) its batch's device row and counter write; a slot taken by a retry
  //                    stores nothing and so costs less
  //     + 2 x linked   the Worker's membership confirmation fills a linked row's null hid at most once, but
  //                    it looks back 24 hours, so on one UTC day it can fill yesterday's rows as well as
  //                    today's: at most two days of the families' share
  //     + 2 x 500      refusal counting: at most REFUSED_DAILY_ROWS reason rows, each with its counter write
  //     The Worker's membership row (one per person per membership read, cached 6 hours, 10 minutes while
  //     her notice is stale) is per person, not per request, and is not in this figure.
  //     In rows changed it must stay under half of 100,000; the billed figure is larger (above).
  {
    const toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
    const m = /^USAGE_DAILY_CAP\s*=\s*"(\d+)"/m.exec(toml);
    const CAP = m ? Number(m[1]) : NaN;
    ok('wrangler.toml sets USAGE_DAILY_CAP', Number.isInteger(CAP) && CAP > 0, m && m[0]);
    const lim = core.ceilingsOf({ USAGE_DAILY_CAP: String(CAP) });
    const RR = core.REFUSED_DAILY_ROWS;
    const MAX = 4 * CAP + 2 * lim.linked + 2 * RR;
    ok('the shares add up to the cap: ' + lim.linked + ' for families, ' + lim.anon + ' with no sign-in', lim.linked + lim.anon === CAP && lim.anon > 0 && lim.anon < lim.linked, lim);
    ok('the stated daily maximum in rows changed (' + MAX + ' at cap ' + CAP + ', not billed rows) is under half of 100,000', MAX < 50000, MAX);

    // One metered database: a trigger per table and operation counts every row write; a wrapper counts D1 calls.
    const raw = fresh();
    raw.raw.exec('CREATE TABLE _w (t TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (t))');
    for (const t of rows(raw, "SELECT name FROM sqlite_master WHERE type = 'table' AND name != '_w'").map((x) => x.name)) {
      raw.raw.exec("INSERT INTO _w VALUES ('" + t + "', 0)");
      for (const op of ['INSERT', 'UPDATE', 'DELETE']) raw.raw.exec('CREATE TRIGGER _w_' + t + '_' + op + ' AFTER ' + op + ' ON ' + t + " BEGIN UPDATE _w SET n = n + 1 WHERE t = '" + t + "'; END");
    }
    let calls = 0;
    const wrap = (s) => Object.assign({}, s, { bind: (...a) => wrap(s.bind(...a)), first: (...x) => { calls++; return s.first(...x); }, run: (...x) => { calls++; return s.run(...x); }, all: (...x) => { calls++; return s.all(...x); } });
    const db = { prepare: (sql) => wrap(raw.prepare(sql)), batch: (list) => { calls++; return raw.batch(list); } };
    const written = () => rows(raw, 'SELECT SUM(n) AS s FROM _w')[0].s;
    const byTable = () => Object.fromEntries(rows(raw, 'SELECT t, n FROM _w WHERE n > 0').map((x) => [x.t, x.n]));
    const isolates = [core.newIsolate(), core.newIsolate(), core.newIsolate()];
    const env = { USAGE_MODE: 'on', USAGE_DAILY_CAP: String(CAP) };
    let dev = 0;
    const device = () => 'd_' + (++dev).toString(36).padStart(12, '0');
    const seenMem = async () => ({ hid: 'h2', role: 'caregiver', notice: 'n2' });
    const linked = (iso, events, extra) => core.ingest(body(events, Object.assign({ device: device() }, extra || {})), ctxOf(db, { env, uid: THEM, notice: 'n2', membership: seenMem, isolate: iso }));
    const anon = (iso, events) => core.ingest(body(events, { device: device() }), ctxOf(db, { env, uid: null, isolate: iso }));
    const scr = (i) => ev('screen.viewed', { screen: core.SCREENS[i % core.SCREENS.length] });
    const feat = (i) => ev('feature.used', { feature: core.FEATURES[i % core.FEATURES.length], action: core.ACTIONS[Math.floor(i / core.FEATURES.length) % core.ACTIONS.length] });
    const visits = (k) => Array.from({ length: k }, () => ev('visit.started', { opened_from: 'link', start: 'cold' }));
    const stored = (where) => rows(raw, 'SELECT COUNT(*) AS c FROM usage_events WHERE ' + where)[0].c;

    // a) The costliest shape: one event a batch, a new device and a new daily total every time.
    const w0 = written();
    for (let i = 0; i < 100; i++) await linked(isolates[i % 3], [i % 2 ? scr(i) : feat(i)]);
    for (let i = 0; i < 100; i++) await anon(isolates[i % 3], [ev('screen.viewed', { screen: i % 2 ? 'signin' : 'landing' }, { t: NOW - i * 3600000 })]);
    const perSlot = (written() - w0) / 200;
    ok('the costliest stored shape writes at most 4 rows an event (measured ' + perSlot + ')', stored('1') === 200 && perSlot <= 4, { perSlot, tables: byTable() });

    // b) Fill both shares to the ceiling, 50 events a batch, rotating through the isolates. The day's two
    //    counters are first moved to 150 short of each share, as if the day had run until now (those slots'
    //    rows are what (a) bounds), so the fill is quick. Loops are bounded: a broken ceiling turns this red.
    const DAYKEY = new Date(NOW).toISOString().slice(0, 10);
    const wSeed = written();
    const seeded = raw.raw.prepare('UPDATE usage_meta SET value = ? WHERE key = ?').run(String(lim.linked - 150), core.ceilingKey('linked', DAYKEY)).changes
      + raw.raw.prepare('UPDATE usage_meta SET value = ? WHERE key = ?').run(String(lim.anon - 150), core.ceilingKey('anon', DAYKEY)).changes;
    ok('(both share counters were found and moved)', seeded === 2, seeded);
    const wb = written(), l0 = stored('uid IS NOT NULL'), a0 = stored('uid IS NULL');
    for (let i = 0; i < 6; i++) { const r = await linked(isolates[i % 3], Array.from({ length: 50 }, (x, k) => feat(i * 50 + k))); if (!r.body.accepted) break; }
    for (let i = 0; i < 6; i++) { const r = await anon(isolates[i % 3], visits(50)); if (!r.body.accepted) break; }
    const fl = stored('uid IS NOT NULL') - l0, fa = stored('uid IS NULL') - a0;
    ok('families filled what was left of their share and no more (' + fl + ' of 150)', fl === 150, fl);
    ok('batches with no sign-in filled what was left of their quarter and no more (' + fa + ' of 150)', fa === 150, fa);
    const fillRows = written() - wb;

    // c) A hostile day across three isolates: past both ceilings, every event refused, the notice unseen.
    const unseen = async () => ({ hid: 'h2', role: 'caregiver', notice: 'n1' });
    const badAll = () => [{ name: 'nope' }, ev('visit.started', { opened_from: 'icon', start: 'cold' }, { id: 'x' }), ev('visit.started', { opened_from: 'icon', start: 'cold' }, { visit: 'bad' }),
      ev('visit.started', { opened_from: 'icon', start: 'cold' }, { t: 'x' }), ev('visit.started', { a: 1 }), ev('feature.used', { feature: 'feed', action: 'logged' })];
    const hostile = async (iso) => {
      await linked(iso, Array.from({ length: 50 }, (x, k) => feat(k)));
      await anon(iso, visits(50));
      await anon(iso, badAll());
      await linked(iso, badAll());
      await core.ingest(body(Array.from({ length: 50 }, (x, k) => scr(k)), { device: device() }), ctxOf(db, { env, uid: ME, notice: 'n2', membership: unseen, isolate: iso }));
    };
    const w1 = written();
    for (let i = 0; i < 150; i++) await hostile(isolates[i % 3]);
    const overhead = written() - w1;
    ok('750 hostile requests write at most 2 x REFUSED_DAILY_ROWS rows (' + overhead + ')', overhead <= 2 * RR, { overhead, tables: byTable() });
    const refusedRows = rows(raw, 'SELECT SUM(n) AS s FROM usage_refused')[0].s;
    ok('companion: refusals were counted until their own ceiling, so the counter could move', overhead > 0 && refusedRows > 0, { overhead, refusedRows });
    // Every isolate has now seen every ceiling full: the same traffic touches D1 no more.
    const c1 = calls, w2 = written();
    for (let i = 0; i < 150; i++) await hostile(isolates[i % 3]);
    ok('once each isolate has seen the day full, 750 more hostile requests make no D1 call', calls === c1, calls - c1);
    ok('and write no row', written() === w2, written() - w2);
    const fresh4 = core.newIsolate(), c2 = calls;
    await linked(fresh4, [feat(1)]);
    ok('companion: a new isolate does ask D1 for the same request (the ceiling, the refusal counter, at most one refusal write)', calls - c2 >= 1 && calls - c2 <= 3, calls - c2);
    const c3 = calls;
    await linked(fresh4, [feat(2)]);
    ok('companion: and makes no call the second time', calls === c3, calls - c3);
    /* Everything (a) to (c) wrote, against the same formula applied to the slots they took: 4 rows a slot,
       plus refusal counting. */
    const slots = 200 + fl + fa, measured = (written() - w0) - (wb - wSeed);   // less the test's own two seeding writes
    ok('all of it, ' + measured + ' rows for ' + slots + ' stored events and every refusal above, is within 4 x slots + 2 x ' + RR + ' (' + (4 * slots + 2 * RR) + ')', measured <= 4 * slots + 2 * RR, { measured, fillRows, overhead, tables: byTable() });

    // d) The isolate remembers a UTC day, not forever: at 00:30 UTC on the 16th the same isolate asks D1 again.
    const NEXT = NOW + 3600000, c4 = calls;
    const nx = await core.ingest(body([feat(3)], { device: device() }), ctxOf(db, { env, uid: THEM, notice: 'n2', membership: seenMem, isolate: isolates[0], now: NEXT }));
    ok('on the next UTC day the same isolate stores again (pinned: 00:30 UTC, 16 Nov 2026)', nx.body.accepted === 1 && calls > c4, { nx, calls: calls - c4 });
  }

  // 15. The day's counters go with their day (VI-3). Every usage_meta key ingest writes on UTC day D starts
  //     with 'events_' + D, so ONE by-day range delete, the shape the erasure lane's retention uses
  //     (key >= 'events_' AND key < 'events_' + the cutoff day), removes all of a past day's counters and
  //     none of a later day's. A key outside that range would be kept forever: a few rows a day, every day.
  {
    const db = fresh();
    const env = { USAGE_MODE: 'on', USAGE_DAILY_CAP: '8' };
    const famCtx = (now) => ctxOf(db, { env, uid: THEM, notice: 'n2', now, membership: async () => ({ hid: 'h2', role: 'caregiver', notice: 'n2' }) });
    const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
    const NEXT = NOW + 3600000;                                      // 00:30 UTC on 16 Nov: the next UTC day
    for (const t of [NOW, NEXT]) {
      await core.ingest(body([ev('feature.used', { feature: 'feed', action: 'logged' }, { t: t - 60000 })]), famCtx(t));               // the families' counter
      await core.ingest(body([ev('visit.started', { opened_from: 'link', start: 'cold' }, { t: t - 60000 })]), ctxOf(db, { env, uid: null, now: t }));  // no sign-in
      await core.ingest(body([{ name: 'nope' }]), ctxOf(db, { env, uid: null, now: t }));                                               // the refusal counter
    }
    const keys = () => rows(db, 'SELECT key FROM usage_meta ORDER BY key').map((x) => x.key);
    const D = dayOf(NOW), D2 = dayOf(NEXT);
    ok('(pinned: ' + D + ' 23:30 UTC, then ' + D2 + ' 00:30 UTC) each day has three counters: families, no sign-in, refusals', D === '2026-11-15' && D2 === '2026-11-16' && keys().length === 6, keys());
    ok('every counter of a day is keyed under events_<that day>', keys().filter((k) => k.startsWith('events_' + D)).length === 3 && keys().filter((k) => k.startsWith('events_' + D2)).length === 3, keys());
    const retire = (cutDay) => db.raw.prepare("DELETE FROM usage_meta WHERE key >= 'events_' AND key < ?").run('events_' + cutDay).changes;
    const kept = retire(D);
    ok('a range delete with the cutoff ON a day keeps all of that day\'s counters', kept === 0 && keys().length === 6, keys());
    const gone = retire(D2);
    ok('one range delete past a day removes all three of its counters and leaves the next day\'s three', gone === 3 && keys().length === 3 && keys().every((k) => k.startsWith('events_' + D2)), keys());
  }

  // 16. What ingest's path leaves behind is erased with its household and retired with its day (F2d, F2e).
  //     eraseHid and runRetention are the erasure lane's code, tested whole in usage-erasure; these checks
  //     cover the two rows that path leaves that no other gate checks: the membership row's household stamp
  //     (written as worker.js usageMembership writes it) and the refusal counts ingest itself writes. The
  //     self-test below breaks each in core.mjs. Pinned: NOW is 23:30 UTC on 15 Nov 2026.
  {
    const db = fresh();
    const A2 = 'carerUid00000000000000000003';
    const stamp = (u, h, r) => db.raw.prepare('INSERT INTO membership (uid, hid, role, notice, checked_at) VALUES (?, ?, ?, ?, ?) '
      + 'ON CONFLICT(uid) DO UPDATE SET hid = excluded.hid, role = excluded.role, notice = excluded.notice, checked_at = excluded.checked_at').run(u, h, r, 'n2', NOW);
    const env = { USAGE_MODE: 'on' };
    for (const [u, h, r] of [[ME, 'hhErase01', 'owner'], [A2, 'hhErase01', 'caregiver'], [THEM, 'hhKeep02', 'owner']]) {
      stamp(u, h, r);
      await core.ingest(body([ev('feature.used', { feature: 'feed', action: 'logged' })], { device: 'd_' + u.slice(0, 12).toLowerCase() }),
        ctxOf(db, { env, uid: u, notice: 'n2', membership: async () => ({ hid: h, role: r, notice: 'n2' }) }));
    }
    ok('(three people stored, two in the household that goes)', rows(db, "SELECT COUNT(*) AS c FROM usage_events WHERE hid = 'hhErase01'")[0].c === 2 && total(db, 'membership') === 3);
    await core.eraseHid(db, 'hhErase01');
    const mem = Object.fromEntries(rows(db, 'SELECT uid, hid, role FROM membership').map((x) => [x.uid, x]));
    ok('after its household is erased, no membership row keeps its hid or its role', rows(db, "SELECT COUNT(*) AS c FROM membership WHERE hid = 'hhErase01'")[0].c === 0
      && [ME, A2].every((u) => !mem[u] || (mem[u].hid === null && mem[u].role === null)), mem);
    ok('companion: a member of another household keeps hers', mem[THEM] && mem[THEM].hid === 'hhKeep02' && mem[THEM].role === 'owner', mem);

    const db2 = fresh();
    const OLD = NOW - 91 * 86400000, RECENT = NOW - 89 * 86400000;
    for (const t of [OLD, RECENT]) await core.ingest(body([{ name: 'nope' }]), ctxOf(db2, { env, uid: null, now: t }));
    const days = () => rows(db2, 'SELECT day FROM usage_refused ORDER BY day').map((x) => x.day);
    ok('(ingest counted a refusal 91 days ago, 2026-08-16, and 89 days ago, 2026-08-18)', days().join() === '2026-08-16,2026-08-18', days());
    await core.runRetention(db2, NOW);
    ok('retention removes the refusal count older than 90 days', !days().includes('2026-08-16'), days());
    ok('companion: and keeps the one 89 days old', days().join() === '2026-08-18', days());
  }
  } catch (e) { fail++; if (!quiet) console.log('  FAIL the suite threw: ' + (e && e.stack || e)); }
  return { pass, fail };
}

/* Self-test: each break must turn the suite red. Each runs from a temp copy of core.mjs (it imports nothing),
   never from the repo, so a killed run leaves no broken core.mjs where a deploy would find it. A copy that
   fails to LOAD is reported as such and never counts as caught; an unaltered copy must pass every check first,
   so each red below is its break's, not the copy's. */
const BREAKS = [
  ['an anonymous screen.viewed for home is stored (§8.3)', "    if (spec.anonScreens && !spec.anonScreens.includes(props.screen)) return { ok: false, reason: 'anon_not_allowed' };\n", ''],
  ['a body naming uid is accepted', "for (const k of ['uid', 'hid', 'role', 'householdId', 'userId'])", "for (const k of ['hid', 'role', 'householdId', 'userId'])"],
  ['a body naming userId is accepted', "for (const k of ['uid', 'hid', 'role', 'householdId', 'userId'])", "for (const k of ['uid', 'hid', 'role', 'householdId'])"],
  ['more than 50 events a batch are accepted', 'body.events.length > LIMITS.maxEvents', 'body.events.length > 100000'],
  ['a free string passes an enum', "if (spec.enum) return typeof v === 'string' && spec.enum.includes(v);", "if (spec.enum) return typeof v === 'string';"],
  ['an id that is not a v4 uuid is stored', 'const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;', 'const UUID4 = /./;'],
  ['native_version is stored as sent', "typeof body.native_version === 'string' && NATIVE.test(body.native_version) ? body.native_version : null", "typeof body.native_version === 'string' ? body.native_version : null"],
  ['device time is not clamped', 'const t = Math.min(Math.max(raw.t, now - LIMITS.pastMs), now + LIMITS.futureMs);', 'const t = raw.t;'],
  ['mode internal stores a family', "if (uid && mode === 'internal' && !internalSet(ctx.env).has(uid)) return", 'if (false) return'],
  ['mode internal stores a request with no sign-in', "if (!uid && mode !== 'on') return", 'if (false) return'],
  ['in mode on, a person who has not seen the notice is stored', "if (mode === 'on' && (!ctx.notice || !mem || mem.notice !== ctx.notice)) {", 'if (false) {'],
  ['a device row is written for a batch refused for the notice (G4)', "      for (let i = 0; i < accepted.length; i++) count('notice');\n",
    "      for (let i = 0; i < accepted.length; i++) count('notice');\n      { const u = coarseUA(ctx.ua); await ctx.db.prepare('INSERT OR REPLACE INTO devices (device, uid, platform, os, browser, app_version, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(env.env.device, uid, env.env.platform, u.os, u.browser, env.env.app_version, now, now).run(); }\n"],
  ['the empty ask goes on to store (a device row)', '  if (!accepted.length) return finish(ctx, iso, refused, 0, mode);\n', ''],
  ['one id from two people collides', "const who = uid || 'anon_' + env.env.device;", "const who = 'anon_' + env.env.device;"],
  ['a retry is counted again', 'if (!(r && r.meta && r.meta.changes > 0)) return;', 'if (!r) return;'],
  ['JOURNEY_KEYS reach a per-person daily row', "const u = a.aggregate || !uid ? '' : uid;", "const u = !uid ? '' : uid;"],
  ['the day ceiling is skipped', 'if (!(await takeSlots(ctx.db, kind, day, n, limits[kind], now))) {', 'if (false) {'],
  ['batches with no sign-in count against the families\' ceiling (W2)', "const kind = uid ? 'linked' : 'anon';", "const kind = 'linked';"],
  ['both shares share one counter (W2)', "anon: '_anon'", "anon: ''"],
  ['the isolate forgets a full day (W1)', 'if (iso.full.get(kind) === day) {', 'if (false) {'],
  ['refusal counting has no ceiling (W1)', "if (await takeSlots(ctx.db, 'refused', day, reasons.length, REFUSED_DAILY_ROWS, ctx.now)) {", 'if (true) {'],
  ['the isolate never learns refusals are full (W1)', "      } else iso.full.set('refused', day);\n", '      }\n'],
  ['a store-failure log line carries the uid', "if (ctx.log) ctx.log('usage_store_fail');", "if (ctx.log) ctx.log('usage_store_fail ' + uid);"],
  ['a first batch bigger than a whole share is stored (VI-4)', '  if (n > cap) return false;\n', ''],
  ['the day counters keep their old prefixes, outside their day (VI-3)', "return 'events_' + day + CEILING_SUFFIX[kind];", "return ({ linked: 'events_', anon: 'anon_events_', refused: 'refused_rows_' })[kind] + day;"],
  ['the refusal counter alone is keyed outside its day (VI-3)', "return 'events_' + day + CEILING_SUFFIX[kind];", "return kind === 'refused' ? 'refused_rows_' + day : 'events_' + day + CEILING_SUFFIX[kind];"],
  /* The next two are the erasure lane's statements. Each anchor is the SQL text alone, which reads the same in
     that lane's rewrite, and each replacement is valid SQL that changes nothing, so a break loads and runs. */
  ['eraseHid leaves the household on its members\' membership rows (F2d)', "'UPDATE membership SET hid = NULL, role = NULL WHERE hid = ?'", "'UPDATE membership SET hid = hid WHERE hid = ?'"],
  ['retention keeps refusal counts past 90 days (F2e)', 'SELECT rowid FROM usage_refused WHERE day < ?', 'SELECT rowid FROM usage_refused WHERE 0 AND day < ?'],
];

(async () => {
  if (!SELF) {
    const r = await suite(CORE, false);
    if (r.loadError) { console.log('  FAIL core.mjs did not load: ' + r.loadError); r.fail++; }
    console.log(r.pass + ' passed, ' + r.fail + ' failed');
    console.log('USAGE-INGEST: ' + (r.fail ? 'FAIL' : 'PASS'));
    process.exit(r.fail ? 1 : 0);
  }
  const SRC = fs.readFileSync(CORE, 'utf8');
  const inTemp = async (src) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-ingest-mut-'));
    const file = path.join(dir, 'workers', 'usage', 'core.mjs');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, src);
    try { return await suite(file, true); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  let good = true, caught = 0;
  const clean = await inTemp(SRC);
  if (clean.loadError) { good = false; console.log('  FAIL an unaltered copy did not load: ' + clean.loadError); }
  else if (clean.fail) { good = false; console.log('  FAIL an unaltered copy in a temp folder fails ' + clean.fail + ' check(s)'); }
  else console.log('  ok   an unaltered copy in a temp folder passes (' + clean.pass + ' checks)');
  for (const [name, find, repl] of BREAKS) {
    const at = SRC.indexOf(find);
    if (at < 0 || SRC.indexOf(find, at + 1) >= 0) { good = false; console.log('  FAIL anchor missing or not unique for: ' + name); continue; }
    const r = await inTemp(SRC.replace(find, repl));
    if (r.loadError) { good = false; console.log('  FAIL did not load, so not caught: ' + name + ' (' + r.loadError + ')'); }
    else if (r.fail > 0) { caught++; console.log('  ok   caught (' + r.fail + ' red): ' + name); }
    else { good = false; console.log('  FAIL not caught: ' + name); }
  }
  console.log('self-test: ' + caught + ' of ' + BREAKS.length + ' breaks caught');
  good = good && caught === BREAKS.length;
  console.log('USAGE-INGEST SELF-TEST: ' + (good ? 'PASS' : 'FAIL'));
  process.exit(good ? 0 : 1);
})().catch((e) => { console.error('threw:', e && e.stack || e); process.exit(1); });
