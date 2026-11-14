/* Cubby Ops never shows what anyone logged (spec §3, §5.1; S10, S11, S13, S36, S37, S41, S42, S45).
 *
 *   node test/admin-no-content.test.js               the suite
 *   node test/admin-no-content.test.js --self-test   also break each rule in a temp copy and require RED
 *
 * The full refresh and every page run against a Google recorder that IGNORES masks and hands back whole
 * documents, seeded with recognisable content (ZZ-..., workers/admin/dev/sample.mjs): a baby's name,
 * notes, doses, a mood, the pregnancy journal, an invitee's address as a pendingInvites key, a live link
 * token as a pendingLinks key, a forged users.email, push tokens, the loss archive, an entry time at a
 * recognisable minute. Not one may reach D1, a response or a log line. The real Firestore's own masking
 * is proven separately on the emulator (test/admin-read-emulator.test.js).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { selfTest } = require('./helpers/admin-selftest');

const ROOT = process.env.ADMIN_ROOT || path.join(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); } };
const DAY = 86400000;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'dev') walk(p, out); } else if (/\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}

/* Capture every console line the Worker writes while fn runs. */
async function captured(fn) {
  const lines = [];
  const o = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...a) => lines.push(a.join(' ')); console.error = console.log; console.warn = console.log;
  try { await fn(); } finally { Object.assign(console, o); }
  return lines;
}

async function everyPage(fx) {
  const out = [];
  const nos = fx.admin.raw.prepare('SELECT display_no FROM dir_households').all().map((r) => r.display_no);
  const paths = ['/', '/?own=show', '/?range=today', '/?range=90&own=show'];
  for (const n of nos) paths.push('/household/' + n, '/manual-access?household=' + n);
  for (const tab of ['people', 'households', 'visits', 'events', 'signins', 'devices', 'access']) paths.push('/records?tab=' + tab + '&own=show');
  for (const tab of ['people', 'households', 'access']) paths.push('/records.csv?tab=' + tab + '&own=show');
  for (const v of ['no_first_entry', 'one_logging', 'invite_waiting']) paths.push('/records?tab=households&own=show&view=' + v);
  paths.push('/records?tab=people&own=show&stage=pregnant', '/records?tab=people&own=show&q=maya');
  for (const p of paths) {
    const r = await fx.request(p);
    out.push({ p, status: r.status, body: await r.text() });
  }
  const post = await fx.request('/api/manual-access', { method: 'POST', headers: { origin: 'https://admin.little-cubby.com', 'content-type': 'application/json' }, body: JSON.stringify({ household: nos[0], reason: 'family_asked' }) });
  out.push({ p: 'POST /api/manual-access', status: post.status, body: await post.text() });
  return out;
}

(async () => {
  const F = await imp('workers/admin/dev/fixture.mjs');
  const S = await imp('workers/admin/dev/sample.mjs');
  const R = await imp('workers/shared/fs-read.mjs');
  const { makeD1 } = await imp('workers/admin/dev/d1-sqlite.mjs');
  const { createFakeGoogle } = await imp('workers/admin/dev/fake-google.mjs');
  console.log('\nadmin no-content: who and how, never what');

  console.log('\n1. the masked reader refuses anything outside §5.1 BEFORE a byte is fetched (S10)');
  {
    /* §5.1, transcribed here from the spec rather than read from the module under test. */
    const SPEC = {
      household: ['ownerId', 'members', 'memberInfo', 'createdAt', 'updatedAt', 'pro', 'deleteAfter', 'pendingInvites', 'pendingLinks', 'app.babies'],
      households: ['ownerId', 'members', 'memberInfo', 'createdAt', 'updatedAt', 'pro', 'deleteAfter', 'pendingInvites', 'pendingLinks', 'app.babies'],
      pregnancy: ['ownerUid', 'sharedWith', 'data.stage', 'data.bornBabyId', 'data.birthAt'],
      events: ['time', 'authorId', 'type'], tally: [],
      user: ['householdId', 'acq', 'referredBy', 'push.enabled', 'push.allow', 'push.tz', 'push.quietStart', 'push.quietEnd', 'teamNotes', 'privacyNoticeSeen'],
      pushLedger: ['caps'], waitlist: ['uid'],
    };
    const have = Object.fromEntries(Object.entries(R.ALLOW).map(([k, v]) => [k, v.fields.slice().sort()]));
    const want = Object.fromEntries(Object.entries(SPEC).map(([k, v]) => [k, v.slice().sort()]));
    ok('the reader\'s allowlist is exactly the spec\'s §5.1, kind by kind', JSON.stringify(have) === JSON.stringify(want), have);
    const w = S.sampleWorld({ content: true });
    const fake = createFakeGoogle({ docs: w.docs, accounts: w.accounts, projectId: w.projectId });
    const reader = R.createReader({ projectId: w.projectId, getToken: async () => 't', fetchImpl: fake.fetchImpl });
    const refusals = [
      ['a kind not in the list (mhealth)', () => reader.getDoc('mhealth', 'households/HHID_sample_maya/mhealth/UID_sample_maya', ['mood'])],
      ['a field not in the list (users.email)', () => reader.getDoc('user', 'users/UID_sample_maya', ['email'])],
      ['a field not in the list (users.name)', () => reader.batchGet('user', ['users/UID_sample_maya'], ['name'])],
      ['the loss archive', () => reader.getDoc('user', 'users/UID_sample_maya', ['pregnancyArchive'])],
      ['push tokens', () => reader.getDoc('user', 'users/UID_sample_maya', ['push.tokens'])],
      ['the due-reminder queue', () => reader.getDoc('user', 'users/UID_sample_maya', ['push.due'])],
      ['a household field beyond the mask (app.settings)', () => reader.getDoc('household', 'households/HHID_sample_maya', ['app.settings'])],
      ['the hold field through the ordinary door', () => reader.getDoc('household', 'households/HHID_sample_maya', ['app.lossHolding'])],
      ['a pregnancy field beyond the mask (data.journal)', () => reader.list('pregnancy', 'households/HHID_sample_leena/pregnancy', ['data.journal'])],
      ['weeks, before F4 says so (data.dueDate)', () => reader.list('pregnancy', 'households/HHID_sample_leena/pregnancy', ['data.dueDate'])],
      ['an event field beyond time, authorId, type (note)', () => reader.query('events', 'households/HHID_sample_maya/events', ['note'])],
      ['a filter on a field it may not read', () => reader.query('events', 'households/HHID_sample_maya/events', ['time'], { where: [{ field: 'amount', op: 'EQUAL', value: { integerValue: '1' } }] })],
      ['an order on a field it may not read', () => reader.query('households', 'households', ['ownerId'], { orderBy: [{ field: 'app.lossHolding', direction: 'ASCENDING' }] })],
      ['a count of notes', () => reader.count('tally', 'households/HHID_sample_maya/notes')],
      ['a path that walks elsewhere', () => reader.getDoc('user', 'users/../signinCodes/x', ['teamNotes'])],
      ['a document read with no mask', () => reader.getDoc('user', 'users/UID_sample_maya', [])],
      ['invites', () => reader.list('households', 'invites', ['ownerId'])],
      ['feedback', () => reader.getDoc('user', 'feedback/f1', ['teamNotes'])],
      ['a batch over 100', () => reader.batchGet('user', Array.from({ length: 101 }, (_, i) => 'users/u' + i), ['teamNotes'])],
    ];
    for (const [label, fn] of refusals) {
      const before = fake.seen.length;
      let threw = false;
      try { await fn(); } catch (e) { threw = e instanceof R.ReadRefused; }
      ok(label + ': refused, and nothing was fetched', threw && fake.seen.length === before, { threw, fetched: fake.seen.length - before });
    }
  }

  console.log('\n2. the full refresh and every page, against whole documents full of content (S11, S42)');
  const fx = await F.buildFixture({ content: true, hostile: true });
  let pages = [];
  const lines = await captured(async () => { await fx.tickUntilDone(); pages = await everyPage(fx); });
  const bad = pages.filter((p) => ![200, 404].includes(p.status));
  ok('every page answered (' + pages.length + ' requests)', bad.length === 0, bad.map((p) => p.p + ' ' + p.status));
  const dump = fx.admin.dump();
  const leaks = [];
  for (const z of S.ZZ) {
    for (const p of pages) if (p.body.includes(z)) leaks.push(z + ' in ' + p.p);
    if (dump.includes(z)) leaks.push(z + ' in D1');
    if (lines.some((l) => l.includes(z))) leaks.push(z + ' in a log line');
  }
  ok('not one planted value reaches any page, CSV, D1 row or log line (' + S.ZZ.length + ' values x ' + pages.length + ' answers)', leaks.length === 0, leaks.slice(0, 12));
  const hhPage = pages.find((p) => p.p === '/household/' + fx.admin.raw.prepare("SELECT display_no FROM dir_households WHERE hid = 'HHID_sample_maya'").get().display_no);
  ok('the address shown is the verified Auth address (S42)', hhPage && hhPage.body.includes('maya@example.com') && !hhPage.body.includes('zz-forged'));
  ok('the name shown is the one her circle sees', hhPage && /<div class="strong">Maya<\/div>/.test(hhPage.body));
  ok('an invitee shows as a relationship and a sent day, no address and no name', hhPage && /Dad<\/div><div class="sub">Invited/.test(hhPage.body) && /Invite sent \d+ \w+, not accepted/.test(hhPage.body));
  ok('a live invite link shows as "Invite link", with no token', hhPage && /Invite link/.test(hhPage.body));
  const minute = '03:17';
  ok('the recognisable entry minute (03:17) appears nowhere', !pages.some((p) => p.body.includes(minute)) && !dump.includes(minute));
  ok('the log lines name codes and counts only, no uid', lines.filter((l) => /UID_sample|HHID_sample/.test(l)).length === 0, lines.filter((l) => /UID_sample|HHID_sample/.test(l)).slice(0, 3));

  console.log('\n3. every Google request carried a mask from §5.1, and nothing wrote (S10, S36)');
  {
    const allowed = new Set(Object.values(R.ALLOW).flatMap((r) => r.fields));
    const problems = [];
    const FORBIDDEN_PATHS = /\/(mhealth|notes|memberEmails|invites|inviteLinks|feedback|signinCodes|campaigns|newsletter|pageStats)(\/|\?|$|:)/;
    for (const s of fx.fake.seen) {
      if (/oauth2\.googleapis\.com\/token$/.test(s.url) || /\/cdn-cgi\/access\/certs$/.test(s.url)) continue;
      if (/identitytoolkit/.test(s.url)) { if (!/accounts:batchGet\?/.test(s.url) || s.method !== 'GET') problems.push('auth ' + s.method + ' ' + s.url); continue; }
      if (s.method !== 'GET' && s.method !== 'POST') { problems.push('write ' + s.method + ' ' + s.url); continue; }
      if (/:commit|:batchWrite|:beginTransaction/.test(s.url)) { problems.push('write ' + s.url); continue; }
      if (FORBIDDEN_PATHS.test(s.url.split('/documents')[1] || '')) { problems.push('forbidden path ' + s.url); continue; }
      let fields = null;
      if (s.method === 'GET') fields = new URL(s.url).searchParams.getAll('mask.fieldPaths');
      else if (/:batchGet$/.test(s.url)) fields = (JSON.parse(s.body).mask || {}).fieldPaths || [];
      else if (/:runQuery$/.test(s.url)) fields = ((JSON.parse(s.body).structuredQuery.select || {}).fields || []).map((f) => f.fieldPath);
      else if (/:runAggregationQuery$/.test(s.url)) {
        const c = JSON.parse(s.body).structuredAggregationQuery.structuredQuery.from[0].collectionId;
        if (!['events', 'photos'].includes(c)) problems.push('count of ' + c);
        continue;
      }
      if (!fields || !fields.length) { problems.push('no mask: ' + s.method + ' ' + s.url); continue; }
      const extra = fields.filter((f) => !allowed.has(f));
      if (extra.length) problems.push('field outside §5.1: ' + extra.join(',') + ' in ' + s.url);
    }
    ok('all ' + fx.fake.seen.length + ' recorded Google requests: masked, inside §5.1, nothing forbidden, nothing written', problems.length === 0, problems.slice(0, 6));
    const code = walk(path.join(ROOT, 'workers', 'admin'), []).concat(walk(path.join(ROOT, 'workers', 'shared'), []));
    const writes = [];
    for (const f of code) {
      const src = fs.readFileSync(f, 'utf8');
      if (/method:\s*['"](PATCH|DELETE|PUT)['"]|:commit\b|:batchWrite\b|accounts:update|accounts:delete|accounts:signUp|:beginTransaction/.test(src)) writes.push(path.relative(ROOT, f));
    }
    ok('no Firestore or Auth write call exists under workers/admin or workers/shared (S36)', writes.length === 0, writes);
    const holds = [];
    for (const f of code) fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (/lossHolding/.test(l)) holds.push(path.relative(ROOT, f) + ':' + (i + 1)); });
    const rd = fs.readFileSync(path.join(ROOT, 'workers', 'shared', 'fs-read.mjs'), 'utf8');
    const fnStart = rd.indexOf('export async function holdRead(');
    const fnBody = fnStart >= 0 ? rd.slice(fnStart, rd.indexOf('\n}\n', fnStart)) : '';
    ok('the loss-hold field is named on exactly one line of admin code, inside holdRead (S12)', holds.length === 1 && /lossHolding/.test(fnBody), holds);
  }

  console.log('\n4. a private pregnancy leaves no trace; no type, no time, no history, no activity (S13, S41, S45)');
  {
    const a = await F.buildFixture({ content: true });
    const b = await F.buildFixture({ content: true, noPrivateJourney: true });
    await a.tickUntilDone(); await b.tickUntilDone();
    const rows = (x) => JSON.stringify(x.admin.raw.prepare('SELECT * FROM dir_households ORDER BY hid').all().map((r) => { delete r.refreshed_at; return r; }));
    const people = (x) => JSON.stringify(x.admin.raw.prepare('SELECT * FROM dir_people ORDER BY uid').all().map((r) => { delete r.refreshed_at; return r; }));
    const days = (x) => JSON.stringify(x.admin.raw.prepare('SELECT * FROM dir_household_days ORDER BY hid, day').all());
    ok('with a journey shared with nobody, and one keyed by a carrier who is not the owner, every directory row equals "no document at all"', rows(a) === rows(b) && people(a) === people(b) && days(a) === days(b));
    const norm = (s) => s.replace(/datetime="[^"]*"/g, '').replace(/<time[^>]*>[^<]*<\/time>/g, '');
    const pa = norm(await (await a.request('/?own=show')).text()), pb = norm(await (await b.request('/?own=show')).text());
    ok('and the overview reads the same', pa === pb);
    const za = a.admin.raw.prepare("SELECT display_no, stage, stage_detail FROM dir_households WHERE hid = 'HHID_sample_zara'").get();
    ok('her household reads "No stage shared"', za.stage === 'none' && za.stage_detail === 'No stage shared', za);
    const ha = norm(await (await a.request('/household/' + za.display_no)).text()), hb = norm(await (await b.request('/household/' + za.display_no)).text());
    ok('and her household page is identical either way', ha === hb);
    const leena = a.admin.raw.prepare("SELECT stage, stage_detail FROM dir_households WHERE hid = 'HHID_sample_leena'").get();
    ok('a journey shared with her partner shows "Pregnant", without weeks (F4)', leena.stage === 'pregnant' && leena.stage_detail === 'Pregnant', leena);
    const nora = a.admin.raw.prepare("SELECT stage, stage_detail FROM dir_households WHERE hid = 'HHID_sample_nora'").get();
    ok('a shared "trying" journey is counted, and never labelled beside her name (F4)', nora.stage === 'trying' && nora.stage_detail === 'No stage shared', nora);
    const all = (await (await a.request('/records?tab=households&own=show')).text()) + (await (await a.request('/records.csv?tab=people&own=show')).text());
    ok('"Trying" appears on no list and in no export', !/Trying/.test(all));
    const overview = await (await a.request('/?own=show')).text();
    ok('only the overview\'s stage bars count it', /<span>Trying<\/span><span>1 household<\/span>/.test(overview));
    const cols = a.admin.raw.prepare("SELECT name FROM pragma_table_info('dir_household_days')").all().map((r) => r.name).join(',');
    ok('the per-day table has no uid, no type and no time column', cols === 'day,hid,entries,authors', cols);
    const R2 = await imp('workers/admin/src/reduce.mjs');
    const kinds = a.admin.raw.prepare('SELECT kinds_7d FROM dir_households WHERE kinds_7d IS NOT NULL').all().flatMap((r) => Object.keys(JSON.parse(r.kinds_7d)));
    ok('kinds are coarse, and only a 7-day count per household', kinds.length > 0 && kinds.every((k) => R2.KINDS.includes(k)), [...new Set(kinds)]);
    const raw = a.admin.dump();
    ok('no raw record type that differs from its kind reaches D1 (temperature, symptom, diaper)', !/"(temperature|symptom|diaper)"/.test(raw));
    const act = a.admin.raw.prepare('SELECT COUNT(*) AS n FROM dir_people WHERE last_sign_in IS NOT NULL OR last_refresh IS NOT NULL OR entries_7d IS NOT NULL').get().n;
    ok('before phase 3, no person has a last sign-in, last seen or entries count (S45)', act === 0, act);
    /* The household page's time zone chip is phase 3 (spec §6.2 "time zone from 3"). The companion below
       proves the matcher finds a chip when one is drawn, so this line cannot be green for free. */
    const tzChip = / time<\/span>/;
    const tzShown = [];
    for (const r of a.admin.raw.prepare('SELECT display_no FROM dir_households').all()) {
      if (tzChip.test(await (await a.request('/household/' + r.display_no)).text())) tzShown.push(r.display_no);
    }
    ok('before phase 3, no household page shows a time zone', tzShown.length === 0, tzShown);
    ok('(companion) the same matcher finds a drawn time zone chip', tzChip.test('<span class="chip">Dubai · UAE time</span>'));
    const tables = a.admin.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    ok('no table holds a stage history', !tables.some((t) => /history|stage_/.test(t)), tables);
  }

  console.log('\n5. the read budget: never past it, and every page says when it is paused (S37)');
  {
    const BUDGET = 40;
    const bx = await F.buildFixture({ content: true, budget: BUDGET });
    let ticks = 0, day = '2026-11-13';
    const meter = () => { const r = bx.admin.raw.prepare("SELECT value FROM admin_meta WHERE key = 'reads'").get(); return r ? JSON.parse(r.value) : { used: 0 }; };
    const billedAt = [bx.fake.state.billed];
    /* Every 15-minute tick from 10:42 to 23:57 UTC, the same pinned day. */
    while (new Date(bx.now() + 15 * 60000).toISOString().slice(0, 10) === day) { await captured(() => bx.tick()); ticks++; bx.setNow(bx.now() + 15 * 60000); }
    const m1 = meter();
    ok(ticks + ' ticks of one day against a large seed: the meter stops at or under ' + BUDGET + ', paused', m1.day === day && m1.used <= BUDGET && m1.paused === true, m1);
    ok('and what Firestore would actually bill, counted by the recorder, is under it too', bx.fake.state.billed - billedAt[0] <= BUDGET, bx.fake.state.billed - billedAt[0]);
    const page = await (await bx.request('/')).text();
    ok('the overview says "Paused to protect families\' quota."', /Paused to protect families(&#39;|') quota\./.test(page));
    const fsBefore = bx.fake.seen.filter((s) => s.url.includes('firestore')).length;
    const hh = await (await bx.request('/household/2')).text();
    ok('a household opened while paused reads nothing from Firestore, and says so', bx.fake.seen.filter((s) => s.url.includes('firestore')).length === fsBefore && /Paused to protect families/.test(hh));
    bx.setNow(Date.UTC(2026, 10, 14, 0, 5, 0));
    const before = bx.fake.state.billed;
    await captured(() => bx.tick());
    const m2 = meter();
    ok('the next UTC day the meter starts again', m2.day === '2026-11-14' && m2.used > 0 && m2.used <= BUDGET, m2);
    ok('and that day too stays under the budget', bx.fake.state.billed - before <= BUDGET, bx.fake.state.billed - before);
  }

  console.log('\n5b. the read budget holds when requests overlap: each reservation is one atomic statement (S37)');
  {
    const M = await imp('workers/admin/src/meter.mjs');
    const { applySqlFile } = await imp('workers/admin/dev/d1-sqlite.mjs');
    const day = '2026-11-13', now = () => S.NOW;
    const fresh = (used) => {
      const d1 = applySqlFile(makeD1(), F.MIGRATION);
      d1.raw.prepare("INSERT OR REPLACE INTO admin_meta (key, value, at) VALUES ('reads', ?, 0)").run(JSON.stringify({ day, used, paused: false, budget: 8000 }));
      return d1;
    };
    const meterOf = (d1) => JSON.parse(d1.raw.prepare("SELECT value FROM admin_meta WHERE key = 'reads'").get().value);
    /* Twenty requests open the meter at the same moment, as twenty isolates would. */
    let d1 = fresh(7945);
    let meters = await Promise.all(Array.from({ length: 20 }, () => M.openMeter(d1, { budget: 8000, now })));
    const granted = (await Promise.all(meters.map((m) => m.reserve(10)))).filter(Boolean).length;
    ok('20 concurrent reservations of 10 with room for 55: exactly 5 granted, and the meter reads 7995', granted === 5 && meterOf(d1).used === 7995, [granted, meterOf(d1)]);
    d1 = fresh(7945);
    meters = await Promise.all(Array.from({ length: 20 }, () => M.openMeter(d1, { budget: 8000, now })));
    const pages = await Promise.all(meters.map((m) => m.reserveUpTo(10)));
    ok('20 concurrent shrinkable pages with room for 55: 55 granted in all, never more, and the meter reads 8000', pages.reduce((a, b) => a + b, 0) === 55 && meterOf(d1).used === 8000, [pages, meterOf(d1)]);
    d1 = fresh(100);
    meters = await Promise.all(Array.from({ length: 20 }, () => M.openMeter(d1, { budget: 8000, now })));
    await Promise.all(meters.map(async (m) => { await m.reserve(100); await m.settle(100, 3); }));
    ok('20 concurrent reserve-then-settle (100 reserved, 3 billed each): the meter keeps every one (100 + 60)', meterOf(d1).used === 160, meterOf(d1));
    d1 = fresh(7999);
    const one = await M.openMeter(d1, { budget: 8000, now });
    ok('a reservation that would pass the cap is refused and marks the day paused', !(await one.reserve(5)) && meterOf(d1).paused === true && meterOf(d1).used === 7999, meterOf(d1));
    d1 = fresh(7999);
    d1.raw.prepare("UPDATE admin_meta SET value = json_set(value, '$.day', '2026-11-12') WHERE key = 'reads'").run();
    const nextDay = await M.openMeter(d1, { budget: 8000, now });
    ok('yesterday\'s total never counts against today', (await nextDay.reserve(50)) && meterOf(d1).day === day && meterOf(d1).used === 50, meterOf(d1));

    /* Through the real handler: twenty household opens at once, starting 20 reads under the cap. */
    const fx = await F.buildFixture({ budget: 8000 });
    await captured(() => fx.tickUntilDone());
    fx.admin.raw.prepare("INSERT OR REPLACE INTO admin_meta (key, value, at) VALUES ('reads', ?, 0)").run(JSON.stringify({ day, used: 7980, paused: false, budget: 8000 }));
    await fx.request('/static/admin.css');
    const billed0 = fx.fake.state.billed;
    fx.fake.state.fault = async () => { await new Promise((r) => setTimeout(r, 3)); return null; };
    const nos = fx.admin.raw.prepare('SELECT display_no FROM dir_households ORDER BY display_no').all().map((r) => r.display_no);
    const statuses = await captured(() => Promise.all(Array.from({ length: 20 }, (_, i) => fx.request('/household/' + nos[i % nos.length]).then((r) => r.status))));
    fx.fake.state.fault = null;
    const billed = fx.fake.state.billed - billed0;
    const m = meterOf(fx.admin);
    ok('20 concurrent household opens: what Firestore bills stays within the 20 reads left (' + billed + ')', 7980 + billed <= 8000, billed);
    ok('and the meter counts every read billed, never fewer (' + m.used + ' = 7980 + ' + billed + ')', m.used === 7980 + billed, [m, billed]);
  }

  if (process.argv.includes('--self-test') && !process.env.ADMIN_MUTANT) {
    selfTest(__filename, [
      { name: 'the reducer keeps the baby\'s name', file: 'workers/admin/src/reduce.mjs', find: 'babyDetail: babies.length ? babyAgeLabel(youngest, now) : null,', replace: 'babyDetail: babies.length ? String(babies[0].name) : null,' },
      { name: 'the reducer keeps the pendingLinks keys', file: 'workers/admin/src/reduce.mjs', find: "invited.push({ kind: 'link', relationship: '',", replace: "invited.push({ kind: 'link', relationship: Object.keys(field(doc, 'pendingLinks') || {}).join(' ')," },
      { name: 'the sharedWith check is dropped', file: 'workers/admin/src/reduce.mjs', find: 'if (!others.length) continue;', replace: '' },
      { name: 'a read goes out without its mask', file: 'workers/shared/fs-read.mjs', find: "const r = await call(base + '/' + path + '?' + maskQs(fields), { method: 'GET' });\n    await settle(1, 1);\n    if (r.status === 404) return null;", replace: "const r = await call(base + '/' + path, { method: 'GET' });\n    await settle(1, 1);\n    if (r.status === 404) return null;" },
      { name: 'raw record types are stored', file: 'workers/admin/src/reduce.mjs', find: "const k = kindOf(field(d, 'type'));", replace: "const k = String(field(d, 'type'));" },
      { name: 'the reservation statement has no cap (the meter never refuses)', file: ['workers/admin/src/meter.mjs', 'workers/admin/src/meter.mjs'],
        find: ["  + 'WHERE (CASE WHEN ' + TODAY + ' THEN ' + USED + ' ELSE 0 END) + ?2 <= ?3 '", "WHERE ?2 <= ?3 "], replace: ['', 'WHERE 1 '] },
      { name: 'a shrinking page is granted without the atomic check', file: 'workers/admin/src/meter.mjs',
        find: 'const got = await db.prepare(RESERVE).bind(day, g, budget, now()).first();',
        replace: "const got = await db.prepare(RESERVE.replace(/WHERE \\(CASE WHEN .*?<= \\?3 /, '').replace('WHERE ?2 <= ?3', 'WHERE 1')).bind(day, g, budget, now()).first();" },
      { name: 'a settlement writes the total this request last saw (a lost update)', file: ['workers/admin/src/meter.mjs', 'workers/admin/src/meter.mjs'],
        find: ["MAX(0, COALESCE(json_extract(value, '$.used'), 0) + ?2)", 'await db.prepare(SETTLE).bind(day, delta, now()).run();'],
        replace: ['MAX(0, ?2)', 'await db.prepare(SETTLE).bind(day, used + delta, now()).run();'] },
      { name: 'the hold field is named in a second function', file: 'workers/admin/src/peek.mjs', find: null, replace: "export const peek = () => 'app.lossHolding';\n" },
      { name: 'invitee names are kept', file: 'workers/admin/src/reduce.mjs', find: "invited.push({ kind: 'email', relationship: cleanText(v && v.relationship, 40),", replace: "invited.push({ kind: 'email', relationship: cleanText(v && v.name, 40)," },
      { name: 'a forbidden field joins the allowlist', file: 'workers/shared/fs-read.mjs', find: "'push.quietStart', 'push.quietEnd', 'teamNotes', 'privacyNoticeSeen'] },", replace: "'push.quietStart', 'push.quietEnd', 'teamNotes', 'privacyNoticeSeen', 'email'] }," },
    ], ok);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('ADMIN-NO-CONTENT: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); console.log('ADMIN-NO-CONTENT: FAIL'); process.exit(1); });
