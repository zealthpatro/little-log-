/* The reminders tally the admin's "Reminders sending" check reads (admin spec §6.1, my call 49).
 *
 *   node test/push-daily.test.js               the suite
 *   node test/push-daily.test.js --self-test   also break each rule in a temp copy of worker.js and require RED
 *
 * recordCronRun keeps, beside push_last_run, a per-UTC-day tally of reminders sent and failed in
 * cubby-games.ops_state.push_daily, so the overview can say "31 sent today, 0 failed". It is for the
 * admin to read; the PUBLIC /api/health must not gain it. D1 is real SQLite; the clock is pinned to a day
 * and an hour, across a UTC midnight.
 */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { DatabaseSync } = require('node:sqlite');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + JSON.stringify(x) : '')); } };
function makeD1() {
  const db = new DatabaseSync(':memory:');
  const st = (sql, args) => ({ bind: (...a) => st(sql, a), run: async () => { db.prepare(sql).run(...(args || [])); return { success: true }; },
    first: async () => { const r = db.prepare(sql).get(...(args || [])); return r ? Object.assign({}, r) : null; },
    all: async () => ({ results: db.prepare(sql).all(...(args || [])).map((r) => Object.assign({}, r)) }) });
  return { prepare: (sql) => st(sql, []), raw: db };
}

(async () => {
  const ROOT = process.env.ADMIN_ROOT || path.join(__dirname, '..');   // a temp copy, to watch it go red on a mutant
  const W = await import(pathToFileURL(path.join(ROOT, 'worker.js')).href);
  const rec = W.__ops && W.__ops.recordCronRun;
  console.log('\npush daily tally: sent and failed, per UTC day, for the admin only');
  ok('worker.js exposes recordCronRun to tests', typeof rec === 'function');
  if (typeof rec !== 'function') { console.log('\n' + pass + ' passed, ' + fail + ' failed\nPUSH-DAILY: FAIL'); process.exit(1); }
  const env = { GAMES_DB: makeD1() };
  const tally = () => { const r = env.GAMES_DB.raw.prepare("SELECT value FROM ops_state WHERE key = 'push_daily'").get(); return r ? JSON.parse(r.value) : null; };
  const T1 = Date.UTC(2026, 10, 13, 10, 45, 0), T2 = Date.UTC(2026, 10, 13, 23, 45, 0), T3 = Date.UTC(2026, 10, 14, 0, 0, 30);
  await rec(env, { due: 5, sent: 4, failed: 1, dropped: 0, userErrors: 0 }, T1);
  ok('the first run of the day starts the tally', JSON.stringify(tally()) === JSON.stringify({ day: '2026-11-13', sent: 4, failed: 1 }), tally());
  await rec(env, { due: 3, sent: 3, failed: 0, dropped: 0, userErrors: 0 }, T2);
  ok('a later run that day adds to it', JSON.stringify(tally()) === JSON.stringify({ day: '2026-11-13', sent: 7, failed: 1 }), tally());
  await rec(env, { due: 2, sent: 2, failed: 0, dropped: 0, userErrors: 0 }, T3);
  ok('the first run after UTC midnight starts again', JSON.stringify(tally()) === JSON.stringify({ day: '2026-11-14', sent: 2, failed: 0 }), tally());
  await rec(env, { due: 0, sent: 0, failed: 0, dropped: 0, userErrors: 0, queryError: 'x', fallback: 'failed' }, T3 + 900000);
  ok('a run that could not read reminders adds nothing', JSON.stringify(tally()) === JSON.stringify({ day: '2026-11-14', sent: 2, failed: 0 }), tally());
  const last = env.GAMES_DB.raw.prepare("SELECT value FROM ops_state WHERE key = 'push_last_run'").get();
  ok('push_last_run is still written as before', last && JSON.parse(last.value).fallback === 'failed', last);
  const res = await W.default.fetch(new Request('https://little-cubby.com/api/health'), env, {});
  const body = await res.text();
  ok('the public /api/health does not carry the daily tally', res.status === 200 && !/push_daily|"sent":2,"failed":0,"day"/.test(body) && !/2026-11-14/.test(body), body.slice(0, 300));
  await rec({}, { sent: 1 }, T1);
  ok('no GAMES_DB means nothing to write, and no throw', true);
  if (process.argv.includes('--self-test') && !process.env.ADMIN_MUTANT) {
    const { selfTest } = require('./helpers/admin-selftest.js');
    selfTest(__filename, [
      { name: 'a second run overwrites the day\'s tally', file: 'worker.js', find: "json_extract(ops_state.value, '$.sent') + ?2", replace: '?2' },
      { name: 'the tally never starts a new day', file: 'worker.js', find: "CASE WHEN json_extract(ops_state.value, '$.day') = ?1", replace: 'CASE WHEN 1 = 1' },
      { name: 'the public /api/health carries the tally', file: 'worker.js',
        find: "SELECT value,updated_at FROM ops_state WHERE key='push_last_run'", replace: "SELECT value,updated_at FROM ops_state WHERE key='push_daily'" },
    ], ok);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('PUSH-DAILY: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); console.log('PUSH-DAILY: FAIL'); process.exit(1); });
