/* The admin's copy of a person goes when the person goes (spec §4.7, §10): the Auth check at the start of
 * every 15-minute tick, whatever the Firestore read budget says; never on a lookup FAILURE.
 *
 *   node test/admin-dir-erasure.test.js               the suite
 *   node test/admin-dir-erasure.test.js --self-test   also break each rule in a temp copy and require RED
 *
 * Clock pinned to a day AND an hour (sample.mjs NOW: Fri 13 Nov 2026, 10:42 UTC).
 */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { selfTest } = require('./helpers/admin-selftest');

const ROOT = process.env.ADMIN_ROOT || path.join(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + JSON.stringify(x).slice(0, 400) : '')); } };
const quiet = async (fn) => { const o = [console.log, console.error]; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { [console.log, console.error] = o; } };

(async () => {
  const F = await imp('workers/admin/dev/fixture.mjs');
  const S = await imp('workers/admin/dev/sample.mjs');
  console.log('\nadmin directory erasure: gone from Auth means gone from the admin on the next tick');
  const has = (fx, uid) => !!fx.admin.raw.prepare('SELECT 1 FROM dir_people WHERE uid = ?').get(uid);
  const hhRows = (fx, hid) => fx.admin.raw.prepare('SELECT (SELECT COUNT(*) FROM dir_households WHERE hid = ?) + (SELECT COUNT(*) FROM dir_household_days WHERE hid = ?) AS n').get(hid, hid).n;
  const drop = (fx, uid) => { const i = fx.world.accounts.findIndex((a) => a.localId === uid); fx.world.accounts.splice(i, 1); };

  console.log('\n1. a deleted person leaves the directory on the next tick, even with the read budget spent');
  {
    const fx = await F.buildFixture({});
    await quiet(() => fx.tickUntilDone());
    ok('Rosa is in the directory to begin with', has(fx, 'UID_sample_rosa'));
    /* Spend today's budget entirely, so no Firestore read can happen this tick. */
    fx.admin.raw.prepare("INSERT OR REPLACE INTO admin_meta (key, value, at) VALUES ('reads', ?, ?)").run(JSON.stringify({ day: '2026-11-13', used: 8000, paused: true, budget: 8000 }), fx.now());
    drop(fx, 'UID_sample_rosa');
    fx.setNow(fx.now() + 15 * 60000);
    const fsBefore = fx.fake.seen.filter((s) => s.url.includes('firestore.googleapis.com')).length;
    await quiet(() => fx.tick());
    ok('the tick read nothing from Firestore (the budget is spent)', fx.fake.seen.filter((s) => s.url.includes('firestore.googleapis.com')).length === fsBefore);
    ok('and still Rosa\'s row is gone', !has(fx, 'UID_sample_rosa'));
    ok('Maya, still in Auth, is untouched', has(fx, 'UID_sample_maya'));
    const page = await (await fx.request('/records?tab=people')).text();
    ok('and the People tab no longer lists Rosa', !page.includes('rosa@example.com') && page.includes('maya@example.com'));
  }

  console.log('\n2. a lookup FAILURE never reads as "gone"');
  for (const [label, fault] of [
    ['a 500 on the first page', (u) => (u.includes('accounts:batchGet') ? new Response('{}', { status: 500 }) : null)],
    ['a 500 on page two of three', (u) => (u.includes('accounts:batchGet') && u.includes('nextPageToken=6') ? new Response('{}', { status: 500 }) : null)],
    ['the network down', (u) => { if (u.includes('accounts:batchGet')) throw new Error('ECONNRESET'); return null; }],
  ]) {
    const fx = await F.buildFixture({});
    await quiet(() => fx.tickUntilDone());
    const before = fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM dir_people').get().n;
    fx.fake.state.authPageSize = 6;
    fx.fake.state.fault = async (u) => fault(u);
    fx.setNow(fx.now() + 15 * 60000);
    const r = await quiet(() => fx.tick());
    ok(label + ': the tick reports the failure and deletes nobody', r && r.auth && r.auth.error && fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM dir_people').get().n === before, [r && r.auth, before]);
  }

  console.log('\n3. a household with nobody left loses every dir_* row');
  {
    const fx = await F.buildFixture({});
    await quiet(() => fx.tickUntilDone());
    const hid = 'HHID_sample_aisha';
    ok('Aisha\'s household has its rows to begin with', hhRows(fx, hid) > 1, hhRows(fx, hid));
    drop(fx, 'UID_sample_aisha'); drop(fx, 'UID_sample_yusuf');
    fx.setNow(fx.now() + 15 * 60000);
    await quiet(() => fx.tick());
    ok('both members gone from Auth: the household and its days are gone on the next tick', hhRows(fx, hid) === 0 && !has(fx, 'UID_sample_aisha') && !has(fx, 'UID_sample_yusuf'), hhRows(fx, hid));
    /* Numbers are never reused. Remove the household holding the HIGHEST number (Priya's, the newest),
       then let a new family arrive: it must get a fresh number, not the one just freed. */
    const priyaNo = fx.admin.raw.prepare("SELECT display_no FROM dir_households WHERE hid = 'HHID_sample_priya'").get().display_no;
    const top = fx.admin.raw.prepare('SELECT MAX(display_no) AS n FROM dir_households').get().n;
    drop(fx, 'UID_sample_priya');
    fx.setNow(fx.now() + 15 * 60000);
    await quiet(() => fx.tick());
    /* Another family saves in between, so its row is re-written (the moment a careless counter would fall back). */
    fx.world.docs.get('households/HHID_sample_maya').updatedAt = new Date(fx.now());
    fx.setNow(fx.now() + 15 * 60000);
    await quiet(() => fx.tick());
    fx.world.docs.set('households/HHID_sample_new', { ownerId: 'UID_sample_new', createdAt: new Date(fx.now()), updatedAt: new Date(fx.now()),
      members: { UID_sample_new: 'owner' }, memberInfo: { UID_sample_new: { name: 'Lina', relationship: 'Mum' } }, app: {} });
    fx.world.docs.set('users/UID_sample_new', { householdId: 'HHID_sample_new' });
    fx.world.accounts.push({ localId: 'UID_sample_new', email: 'lina@example.com', emailVerified: true, createdAt: String(fx.now()), providerUserInfo: [] });
    fx.setNow(fx.now() + 15 * 60000);
    await quiet(() => fx.tick());
    const fresh = fx.admin.raw.prepare("SELECT display_no FROM dir_households WHERE hid = 'HHID_sample_new'").get();
    ok('a freed number (' + priyaNo + ', the highest) is never handed out again: the next family gets ' + (top + 1), priyaNo === top && fresh && fresh.display_no === top + 1, { priyaNo, top, fresh });
    /* One member left: the household stays, with one person. */
    drop(fx, 'UID_sample_rosa');
    fx.setNow(fx.now() + 15 * 60000);
    await quiet(() => fx.tick());
    ok('a household with someone still in it keeps its rows', hhRows(fx, 'HHID_sample_maya') > 1);
    /* The full listing also drops a household Firestore no longer has. */
    fx.world.docs.delete('households/HHID_sample_nora');
    fx.setNow(Date.UTC(2026, 10, 14, 0, 5, 0));
    await quiet(async () => { for (let i = 0; i < 10; i++) { await fx.tick(); fx.setNow(fx.now() + 15 * 60000); } });
    ok('a household gone from Firestore leaves the directory at the next full pass', hhRows(fx, 'HHID_sample_nora') === 0);
    const nora = fx.admin.raw.prepare("SELECT hid FROM dir_people WHERE uid = 'UID_sample_nora'").get();
    ok('and its people no longer point at it', nora && nora.hid === null, nora);
  }

  console.log('\n4. per-day rows live 90 days, on a pinned clock');
  {
    const fx = await F.buildFixture({});
    await quiet(() => fx.tickUntilDone());
    const ins = fx.admin.raw.prepare('INSERT OR REPLACE INTO dir_household_days (day, hid, entries, authors) VALUES (?, ?, 1, 1)');
    ins.run('2026-08-15', 'HHID_sample_dana');   // 90 days before 13 Nov
    ins.run('2026-08-14', 'HHID_sample_dana');   // 91 days before
    fx.setNow(fx.now() + 15 * 60000);
    await quiet(() => fx.tick());
    const days = fx.admin.raw.prepare("SELECT day FROM dir_household_days WHERE hid = 'HHID_sample_dana' AND day < '2026-09-01' ORDER BY day").all().map((r) => r.day);
    ok('the 91-day-old row does not survive the run; the 90-day-old one does', JSON.stringify(days) === JSON.stringify(['2026-08-15']), days);
  }

  console.log('\n5. one household the reader cannot read never freezes the daily pass for everyone');
  {
    /* Any signed-in stranger may create households/{any id}, and Firestore ids may hold '.', '~', a space
       or an accent, which the masked reader rightly refuses. Before this fix the daily pass kept such a
       household first in its queue forever (it is created earliest), so nobody's numbers were refreshed. */
    let strangers = 0;
    const weird = (fx, hid) => {
      /* A stranger signs up and creates the oddly named household (their users doc names it, as the app's own). */
      const uid = 'UID_sample_stranger' + (++strangers);
      fx.world.accounts.push({ localId: uid, email: 'stranger' + strangers + '@example.com', emailVerified: true, createdAt: String(S.NOW - 400 * S.DAY), providerUserInfo: [] });
      fx.world.docs.set('users/' + uid, { householdId: hid });
      fx.world.docs.set('households/' + hid, { ownerId: uid, createdAt: new Date(S.NOW - 400 * S.DAY),
        members: { [uid]: 'owner' }, memberInfo: { [uid]: { name: 'Jo', relationship: 'Mum' } }, app: {} });
    };
    const daily = (fx) => JSON.parse(fx.admin.raw.prepare("SELECT value FROM admin_meta WHERE key = 'daily'").get().value);
    const detailed = (fx) => fx.admin.raw.prepare("SELECT COUNT(*) AS n FROM dir_households WHERE entries_total IS NOT NULL AND hid LIKE 'HHID_sample_%'").get().n;
    const normal = 8;
    const band = /(\d+) (household|households) could not be refreshed\./;
    for (const [label, stage, want] of [
      ['an id the reader refuses (zz.stall)', (fx) => weird(fx, 'zz.stall'), 1],
      ['an id with a space and an accent', (fx) => { weird(fx, 'zz stall'); weird(fx, 'zzé'); }, 2],
      ['a well-formed household whose detail read fails', (fx) => {
        fx.fake.state.fault = async (u) => (u.includes('/households/HHID_sample_dana/') ? new Response('{}', { status: 500 }) : null);
      }, 1],
    ]) {
      const fx = await F.buildFixture({});
      stage(fx);
      let ticks = 0;
      const lines = [];
      const o = [console.log, console.error];
      console.log = () => {}; console.error = (...a) => lines.push(a.join(' '));
      try { for (; ticks < 40; ticks++) { await fx.tick(); if (daily(fx).phase === 'done') break; fx.setNow(fx.now() + 15 * 60000); } }
      finally { [console.log, console.error] = o; }
      const d = daily(fx);
      const refusedTries = lines.filter((l) => /^admin_detail_fail /.test(l));
      if (!label.startsWith('a well-formed')) ok(label + ': the refused id is skipped when listed, never even tried in detail', refusedTries.length === 0, refusedTries);
      else ok(label + ': (companion) the same log line is written when a detail read is tried and fails', lines.some((l) => /^admin_detail_fail /.test(l)), lines.slice(0, 3));
      const expectDetailed = label.startsWith('a well-formed') ? normal - 1 : normal;
      ok(label + ': the daily pass still finishes (' + (ticks + 1) + ' ticks)', d.phase === 'done' && d.queue.length === 0, { phase: d.phase, left: d.queue.length });
      ok(label + ': and every other household got its detail (' + detailed(fx) + ' of ' + expectDetailed + ')', detailed(fx) === expectDetailed, detailed(fx));
      const page = await (await fx.request('/')).text();
      const m = band.exec(page);
      ok(label + ': and every page says "' + want + ' ' + (want === 1 ? 'household' : 'households') + ' could not be refreshed."', !!m && Number(m[1]) === want && (want === 1) === (m[2] === 'household'), m && m[0]);
    }
    {
      /* A paused budget is not a failure: the household waits for tomorrow's budget, and nothing is counted. */
      const fx = await F.buildFixture({ budget: 60 });
      await quiet(async () => { for (let i = 0; i < 20; i++) { await fx.tick(); fx.setNow(fx.now() + 15 * 60000); } });
      const d = daily(fx);
      ok('a spent read budget pauses the pass without counting anyone as failed', d.phase === 'detail' && (d.failed || 0) === 0 && d.queue.length > 0, { phase: d.phase, failed: d.failed, left: d.queue.length });
      const page = await (await fx.request('/')).text();
      ok('and no page says anything could not be refreshed', !band.test(page));
    }
  }

  console.log('\n6. a person is listed under a household only when users/{uid}.householdId agrees');
  {
    /* An owner may write any uid into their own household's members map (firestore.rules). Before this fix
       the directory filed that person, with their verified address, under the hostile household (one
       household per uid, last writer wins). users/{uid}.householdId is the person's own side: only when both
       agree is the person listed there. Priya's household is the newer, so it is written after Leena's. */
    const hostile = (fx) => {
      const hh = fx.world.docs.get('households/HHID_sample_priya');
      hh.members.UID_sample_leena = 'caregiver';
      hh.memberInfo.UID_sample_leena = { name: 'Leena', relationship: 'Friend', joinedAt: new Date(S.NOW - S.DAY) };
    };
    const hidOf = (fx, uid) => (fx.admin.raw.prepare('SELECT hid FROM dir_people WHERE uid = ?').get(uid) || {}).hid;
    const no = (fx, hid) => fx.admin.raw.prepare('SELECT display_no FROM dir_households WHERE hid = ?').get(hid).display_no;
    {
      const fx = await F.buildFixture({});
      hostile(fx);
      await quiet(() => fx.tickUntilDone());
      ok('after the daily pass, Leena is still listed under her own household', hidOf(fx, 'UID_sample_leena') === 'HHID_sample_leena', hidOf(fx, 'UID_sample_leena'));
      const priya = await (await fx.request('/household/' + no(fx, 'HHID_sample_priya'))).text();
      const leena = await (await fx.request('/household/' + no(fx, 'HHID_sample_leena'))).text();
      ok('the hostile household\'s page (read fresh) does not show her or her address', !priya.includes('leena@example.com') && priya.includes('priya@example.com'));
      ok('her own household\'s page does', leena.includes('leena@example.com'));
      const people = await (await fx.request('/records.csv?tab=people')).text();
      const row = people.split('\r\n').find((l) => l.includes('leena@example.com')) || '';
      ok('and the People export files her under Household ' + no(fx, 'HHID_sample_leena'), row.includes('"Household ' + no(fx, 'HHID_sample_leena') + '"'), row);
      /* The 15-minute pass, after the hostile owner saves again. */
      fx.world.docs.get('households/HHID_sample_priya').updatedAt = new Date(fx.now() + 60000);
      fx.setNow(fx.now() + 15 * 60000);
      await quiet(() => fx.tick());
      ok('and the 15-minute pass does not move her either', hidOf(fx, 'UID_sample_leena') === 'HHID_sample_leena', hidOf(fx, 'UID_sample_leena'));
    }
    {
      /* Companion: when she really did move (her own users doc names Priya's household too), she is listed
         there, so the agreement check is not green for free. */
      const fx = await F.buildFixture({});
      hostile(fx);
      fx.world.docs.get('users/UID_sample_leena').householdId = 'HHID_sample_priya';
      await quiet(() => fx.tickUntilDone());
      ok('(companion) when both sides agree, she is listed under the household she moved to', hidOf(fx, 'UID_sample_leena') === 'HHID_sample_priya', hidOf(fx, 'UID_sample_leena'));
      const priya = await (await fx.request('/household/' + no(fx, 'HHID_sample_priya'))).text();
      ok('(companion) and that household\'s page shows her', priya.includes('leena@example.com'));
    }
  }

  if (process.argv.includes('--self-test') && !process.env.ADMIN_MUTANT) {
    selfTest(__filename, [
      { name: 'a failed Auth page is skipped, not fatal', file: 'workers/shared/auth-read.mjs', find: "if (!r.ok) throw new Error('auth_list_' + r.status);", replace: 'if (!r.ok) break;' },
      { name: 'the Auth check waits for the read budget', file: 'workers/admin/src/directory.mjs', find: '  let authUids = null;\n  try {', replace: '  let authUids = null;\n  if (meter.used >= cfg.budget) report.auth = { error: \'budget\' };\n  else try {' },
      { name: 'an emptied household keeps its rows', file: 'workers/admin/src/directory.mjs', find: "  stmts.push(db.prepare('DELETE FROM dir_households WHERE hid IN (' + orphan + ')'));", replace: '' },
      { name: 'day rows live 120 days', file: 'workers/admin/src/directory.mjs', find: 'keepDays: 90 }', replace: 'keepDays: 120 }' },
      /* N2: each half on its own (either alone would unfreeze the pass, so each has its own assertion). */
      { name: 'an id the reader refuses is queued anyway', file: 'workers/admin/src/directory.mjs', find: 'if (DOC_ID.test(h.hid)) st.queue.push(h.hid); else st.failed = (st.failed || 0) + 1;', replace: 'st.queue.push(h.hid);' },
      { name: 'one household\'s failure stops the pass for everyone', file: 'workers/admin/src/directory.mjs',
        find: "    try { await detailOne(db, reader, cfg, t, st.queue[0]); }\n    catch (e) {\n      if (e instanceof BudgetPaused) throw e;\n      st.failed = (st.failed || 0) + 1;\n      console.error('admin_detail_fail', code(e));\n    }",
        replace: '    await detailOne(db, reader, cfg, t, st.queue[0]);' },
      { name: 'a spent budget counts as a failure', file: 'workers/admin/src/directory.mjs', find: '      if (e instanceof BudgetPaused) throw e;\n      st.failed', replace: '      st.failed' },
      { name: 'the pages do not say how many could not be refreshed', file: 'workers/admin/src/views.mjs', find: 'if (state.unrefreshed > 0) out.push(', replace: 'if (false) out.push(' },
      /* N7: both sides of membership, in the directory and on the live household page. */
      { name: 'the members map alone files a person under a household', file: 'workers/admin/src/directory.mjs', find: ' && claims && claims.get(m.uid) === h.hid);', replace: ');' },
      { name: 'the live household page trusts the members map', file: 'workers/admin/src/index.mjs', find: 'byUid.has(m.uid) && agrees(m)', replace: 'byUid.has(m.uid)' },
      { name: 'display numbers are reused', file: 'workers/admin/src/directory.mjs', find: "WHERE key = 'display_no_next' AND CAST(value AS INTEGER) <= (SELECT MAX(display_no) FROM dir_households)", replace: "WHERE key = 'display_no_next'" },
    ], ok);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('ADMIN-DIR-ERASURE: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); console.log('ADMIN-DIR-ERASURE: FAIL'); process.exit(1); });
