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
 *
 * Phase 2 (§6, §7): cubby-usage. Before families are told, no per-person activity about a family is shown:
 * a family member's usage rows, staged as the server would store them, change no page, tab or CSV at all,
 * and every read that names a person carries the one scope (usage.mjs usageScope). Her pregnancy or trying
 * use is the one exception, by design: those tools are kept only as daily totals with no person in them, so
 * her use joins the overview's total (and the note there says so), and nothing else moves. Rows the server
 * would refuse (unknown events, props outside the allowlist, hostile strings) never reach a page as
 * themselves (§7), and a hostile name on one of our own accounts stays text on every usage tab and CSV (§8).
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
  for (const tab of ['people', 'households', 'visits', 'events', 'signins', 'devices', 'access']) paths.push('/records.csv?tab=' + tab + '&own=show');
  for (const tab of ['visits', 'events', 'signins', 'devices']) paths.push('/records?tab=' + tab, '/records?tab=' + tab + '&own=show&page=2');
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

  console.log('\n6. phase 2: no per-person activity about a family, only our own accounts, through one helper (S45, §17, §8.4)');
  {
    const U = await imp('workers/admin/src/usage.mjs');
    const visit = (secs, extra) => [[0, 'visit.started', { opened_from: 'icon', start: 'cold' }]].concat(extra || []).concat([[secs, 'visit.ended', { seconds: secs, reason: 'hidden' }]]);
    /* Maya (a family, not ours), as the server WOULD store her if it measured her: mode "on", notice seen.
       Every row she leaves carries a marker that no other row has. No pregnancy or trying tool: those are
       kept only as daily totals with no person in them, which nobody owns (§8.4). */
    const MAYA = { uid: 'UID_sample_maya', hid: 'HHID_sample_maya', tz: 'Asia/Dubai', device: 'd_zzstranger01', platform: 'android_app',
      app_version: 'v7731', native_version: '77.31', ua: S.USAGE_UA.android };
    const MINE = { uid: S.FOUNDER_UID, hid: 'HHID_sample_founder', tz: 'Asia/Dubai', device: 'd_zzmine000001', platform: 'browser', app_version: 'v7730', ua: S.USAGE_UA.mac, visit: 'v_zzmine01' };
    const HERS = ['v7731', 'v7700', '77.31', '1h 12m', 'd_zzstranger', 'v_zzstr'];
    const OURS = ['v7730', 'v_zzmine01', '1h 30m'];
    const stageMaya = async (d1) => {
      for (let i = 0; i < 6; i++) {
        await S.ingestVisit(d1, Object.assign({ visit: 'v_zzstr00' + i }, MAYA), S.NOW - (6 - i) * 7 * 3600000, visit(4321, [
          [5, 'screen.viewed', { screen: 'photos' }], [9, 'feature.used', { feature: 'feed', action: 'logged' }],
          [12, 'save.failed', { error: 'unavailable', retries: 3, offline: 'yes' }],
          [20, 'signin.attempted', { method: 'email_code', step: 'verified', outcome: 'failed', error: 'wrong_code', attempt: 2, storage: 'browser' }],
          [30, 'app.updated', { from_version: 'v7700', to_version: 'v7731' }]]), { mode: 'on', notice: 'n1', internal: '' });
      }
    };
    const seedOurs = async (d1) => { await S.seedUsage(d1); await S.ingestVisit(d1, MINE, S.NOW - 3 * 3600000, visit(5432, [[7, 'feature.used', { feature: 'sleep', action: 'logged' }]])); };
    const stmts = { a: [], b: [] };
    const hook = (k) => ({ before: (sql, args) => { stmts[k].push({ sql, args }); } });
    const a = await F.buildFixture({ usage: async (d1) => { await seedOurs(d1); await stageMaya(d1); }, usageHooks: hook('a') });
    const b = await F.buildFixture({ usage: seedOurs, usageHooks: hook('b') });
    const mayaRows = a.usage.raw.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE uid = 'UID_sample_maya'").get().n;
    ok('staged: ' + mayaRows + ' usage events of hers, with her household stamped, her daily totals and her device', mayaRows === 42
      && a.usage.raw.prepare("SELECT COUNT(*) AS n FROM usage_daily WHERE uid = 'UID_sample_maya' AND hid = 'HHID_sample_maya'").get().n > 0
      && a.usage.raw.prepare("SELECT COUNT(*) AS n FROM devices WHERE uid = 'UID_sample_maya'").get().n === 1, mayaRows);
    let pa = [], pb = [];
    stmts.a.length = 0; stmts.b.length = 0;
    await captured(async () => { await a.tickUntilDone(); await b.tickUntilDone(); pa = await everyPage(a); pb = await everyPage(b); });
    const norm = (x) => x.replace(/datetime="[^"]*"/g, '').replace(/<time[^>]*>[^<]*<\/time>/g, '');
    const differ = pa.filter((x, i) => norm(x.body) !== norm(pb[i].body) || x.status !== pb[i].status).map((x) => x.p);
    ok('with her rows in cubby-usage, every page, tab and CSV reads exactly as without them (' + pa.length + ' answers)', differ.length === 0 && pa.length === pb.length, differ.slice(0, 8));
    const found = (marks, pages) => marks.filter((z) => pages.some((x) => x.body.includes(z)));
    ok('none of her markers (version, app build, a 1h 12m visit, device, visit ids) appears anywhere', found(HERS, pa).length === 0, found(HERS, pa));
    ok('(companion) the same matcher finds our own staged markers on those pages', found(OURS, pa).length === OURS.length, found(OURS, pa));
    const mayaNo = a.admin.raw.prepare("SELECT display_no FROM dir_households WHERE hid = 'HHID_sample_maya'").get().display_no;
    const mp = (pa.find((x) => x.p === '/household/' + mayaNo) || {}).body || '';
    ok('her household page waits on failed saves and sign-in problems, though she has 6 of each', /Failed saves, 7 days<\/span><span class="sub">Waiting for usage events</.test(mp) && /Sign-in problems, 7 days<\/span><span class="sub">Waiting for usage events</.test(mp));
    /* Every statement that reads a table naming a person carries the scope, bound to our own uids only. */
    const PERSON = /FROM (usage_events|usage_daily|devices)\b/;
    const unscoped = stmts.a.filter((x) => PERSON.test(x.sql) && !(/\b(d\.)?uid IN \(\?(, \?)*\)/.test(x.sql) && x.args.includes(S.FOUNDER_UID)) && !/WHERE uid = '' AND hid = ''/.test(x.sql));
    ok('every read of usage_events, usage_daily or devices (' + stmts.a.filter((x) => PERSON.test(x.sql)).length + ') is limited to our own uids by the one scope', stmts.a.length > 50 && unscoped.length === 0, unscoped.slice(0, 2).map((x) => x.sql.slice(0, 160)));
    ok('and not one of them is bound to her uid', !stmts.a.some((x) => x.args.includes('UID_sample_maya')));
    const totalsOnly = stmts.a.filter((x) => PERSON.test(x.sql) && /WHERE uid = '' AND hid = ''/.test(x.sql));
    ok('the one read without a person is the pregnancy-and-trying totals (uid and household empty)', totalsOnly.length > 0 && totalsOnly.every((x) => /metric = 'feature'/.test(x.sql) && /key IN \(/.test(x.sql)), totalsOnly.length);
    /* The helper itself. */
    const cfg = (internal, usage) => ({ usage: usage === false ? null : {}, internal: new Set(internal) });
    const sc = U.usageScope(cfg([S.FOUNDER_UID, 'x y', 'UID_two']), false);
    ok('usageScope: our own uids (well formed), sorted', JSON.stringify(sc.uids) === JSON.stringify([S.FOUNDER_UID, 'UID_two']) && sc.where('uid') === 'uid IN (?, ?)' && sc.has(S.FOUNDER_UID) && !sc.has('UID_sample_maya'));
    ok('usageScope: nobody while "Hide our own accounts" is ticked, when nothing is tagged, or with cubby-usage unbound',
      U.usageScope(cfg([S.FOUNDER_UID]), true).empty && U.usageScope(cfg([]), false).empty && U.usageScope(cfg([S.FOUNDER_UID], false), false).empty);
    /* JOURNEY_KEYS: totals only, never per person. */
    const JOURNEY = /\b(pregnancy_week|kicks|contractions|cycle)\b|Pregnancy week|Kick counts|Contraction|\bCycle\b/;
    const perPerson = pa.filter((x) => /^\/(household\/|records(\.csv)?\?tab=(visits|events|signins|devices))/.test(x.p));
    const named = perPerson.filter((x) => JOURNEY.test(x.body)).map((x) => x.p);
    ok('no per-person view or CSV names a pregnancy or trying tool (' + perPerson.length + ' answers), though our rows hold one', named.length === 0
      && a.usage.raw.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE uid = ? AND props LIKE '%pregnancy_week%'").get(S.FOUNDER_UID).n > 0, named);
    ok('(companion) the same matcher finds it where it belongs: the overview\'s totals', JOURNEY.test((pa.find((x) => x.p === '/?own=show') || {}).body || ''));
    /* Her kick count. Pregnancy and trying tools are stored as daily totals with no person in them (§8.4), so
       her use joins the overview's total, which the note beside it says counts everyone the server stored;
       her household and she are not counted, and no other page, tab or CSV moves. */
    const kicks = async (d1) => { await seedOurs(d1); await S.ingestVisit(d1, Object.assign({ visit: 'v_zzkick01' }, MAYA), S.NOW - 2 * 3600000,
      visit(60, [[5, 'screen.viewed', { screen: 'kicks' }], [9, 'feature.used', { feature: 'kicks', action: 'logged' }]]), { mode: 'on', notice: 'n1', internal: '' }); };
    const c = await F.buildFixture({ usage: kicks });
    let pc = [];
    await captured(async () => { await c.tickUntilDone(); pc = await everyPage(c); });
    ok('staged: her kick count is a total with no person or household in it', c.usage.raw.prepare("SELECT SUM(n) AS n FROM usage_daily WHERE uid = '' AND hid = '' AND metric = 'feature' AND key = 'kicks'").get().n === 1);
    const changed = pc.filter((x, i) => norm(x.body) !== norm(pb[i].body) || x.status !== pb[i].status).map((x) => x.p);
    ok('her kick count changes only the overview with our own accounts shown (' + pc.length + ' answers)', JSON.stringify(changed) === JSON.stringify(['/?own=show', '/?range=90&own=show']), changed);
    const cut = (body) => { const i = body.indexOf('>What people use</h2>'); return i < 0 ? body : body.slice(0, i) + body.slice(body.indexOf('</section>', i)); };
    ok('and on those two pages, only the "What people use" card', changed.length === 2 && changed.every((p) => norm(cut(pc.find((x) => x.p === p).body)) === norm(cut(pb.find((x) => x.p === p).body))));
    const ov = (pc.find((x) => x.p === '/?own=show') || {}).body || '';
    const kickRow = (/<tr><td class="strong">Kick counts \*<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td>/.exec(ov) || []).slice(1);
    ok('her use is in the total, but neither her household nor she is counted: "Kick counts *" 0, 0, 1', JSON.stringify(kickRow) === '["0","0","1"]', kickRow);
    ok('and the note beside it says those uses are not limited to our own accounts', ov.includes('so their uses count everyone the server stored, not only our own accounts.'), (ov.match(/<p class="note">\*[^<]*/) || [''])[0]);
  }

  console.log('\n7. rows the server would refuse never reach a page as themselves (S14, S23): allowlisted values only, fixed labels');
  {
    const V = await imp('workers/admin/src/views.mjs');
    const core = await imp('workers/usage/core.mjs');
    const fx = await F.buildFixture({ usage: async (d1) => { await S.seedUsage(d1); S.stageOddUsage(d1); } });
    let pages = [];
    await captured(async () => { await fx.tickUntilDone(); pages = await everyPage(fx); });
    const leaks = [];
    for (const z of S.ZZ.concat(['onerror', '__pwned', 'ZZ/Hostile'])) for (const p of pages) if (p.body.includes(z)) leaks.push(z + ' in ' + p.p);
    ok('not one planted string, hostile or otherwise, reaches a page or CSV (' + pages.length + ' answers)', leaks.length === 0, leaks.slice(0, 8));
    const ev = (pages.find((x) => x.p === '/records.csv?tab=events&own=show') || {}).body || '';
    ok('(companion) the odd rows ARE listed, their unknown parts replaced: an "Unknown event", and "action: logged" alone', /"Unknown event"/.test(ev) && /"action: logged"/.test(ev) && (ev.match(/v_zzodd001/g) || []).length === 6, (ev.match(/[^\n]*v_zzodd001[^\n]*/g) || []).slice(0, 4));
    const dv = (pages.find((x) => x.p === '/records.csv?tab=devices&own=show') || {}).body || '';
    ok('(companion) the odd device is listed as "Other", "Other", "Unknown", with no app build and "Not recorded"', /"Sam","Browser tab","Other","Other","Unknown","","Not recorded"/.test(dv), dv.split('\r\n').slice(0, 7));
    const want = (list, map) => list.filter((k) => !Object.prototype.hasOwnProperty.call(map || {}, k));
    const missing = [].concat(want(core.SCREENS, V.SCREEN_LABEL), want(core.FEATURES, V.FEATURE_LABEL), want(core.PLATFORMS, V.PLATFORM_LABEL));
    ok('every allowlisted screen, feature and platform has a fixed label, so none is ever spelled from its own string', missing.length === 0, missing);
  }

  console.log('\n8. a hostile name on one of our own accounts stays text on every usage tab, page and CSV (S14)');
  {
    /* The hostile household made ours, so its names reach the usage tabs at all: one member is named with
       markup, the other with a spreadsheet formula (workers/admin/dev/sample.mjs). */
    const OURS8 = [S.FOUNDER_UID, 'UID_sample_hostile', 'UID_sample_hostile2'].join(',');
    const member = (uid, device, role) => ({ uid, hid: 'HHID_sample_hostile', role, tz: 'Asia/Dubai', device, platform: 'browser', app_version: 'v369', ua: S.USAGE_UA.mac });
    const steps = [[0, 'visit.started', { opened_from: 'icon', start: 'cold' }],
      [4, 'signin.attempted', { method: 'google', step: 'signed_in', outcome: 'succeeded', error: 'none', attempt: 1, storage: 'browser' }],
      [9, 'feature.used', { feature: 'feed', action: 'logged' }], [30, 'visit.ended', { seconds: 30, reason: 'hidden' }]];
    const fx = await F.buildFixture({ hostile: true, env: { INTERNAL_UIDS: OURS8 }, usage: async (d1) => {
      await S.ingestVisit(d1, member('UID_sample_hostile', 'd_zzhostile001', 'owner'), S.NOW - 3 * 3600000, steps, { internal: OURS8 });
      await S.ingestVisit(d1, member('UID_sample_hostile2', 'd_zzhostile002', 'caregiver'), S.NOW - 2 * 3600000, steps, { internal: OURS8 });
    } });
    const pages = [];
    await captured(async () => {
      await fx.tickUntilDone();
      const no = fx.admin.raw.prepare("SELECT display_no FROM dir_households WHERE hid = 'HHID_sample_hostile'").get().display_no;
      const paths = ['/household/' + no];
      for (const tab of ['visits', 'events', 'signins', 'devices']) paths.push('/records?tab=' + tab + '&own=show', '/records.csv?tab=' + tab + '&own=show');
      for (const p of paths) { const r = await fx.request(p); pages.push({ p, status: r.status, body: await r.text() }); }
    });
    const htmlPages = pages.filter((x) => !x.p.startsWith('/records.csv'));
    const csvs = pages.filter((x) => x.p.startsWith('/records.csv'));
    const RAW = /<img src=x|<script>window\.__pwned/;
    ok('no page carries her name as markup (' + htmlPages.length + ' pages: the household and the four usage tabs)', htmlPages.length === 5 && htmlPages.every((x) => x.status === 200 && !RAW.test(x.body)),
      htmlPages.filter((x) => RAW.test(x.body)).map((x) => x.p));
    const ESC = '&lt;img src=x onerror=&quot;window.__pwned=1&quot;&gt;';
    const nameCells = (body) => (body.match(/<td[^>]*>(?:<a [^>]*>)?[^<]*&lt;img src=x[^<]*/g) || []).length;
    ok('(companion) her name IS in each usage tab\'s rows, and on the household page\'s visits, as text', htmlPages.every((x) => x.body.includes(ESC))
      && htmlPages.filter((x) => x.p.startsWith('/records?')).every((x) => nameCells(x.body) >= 1)
      && /<ul class="visits">[\s\S]*?&lt;img src=x[\s\S]*?<\/ul>/.test(htmlPages[0].body), htmlPages.map((x) => x.p + ' ' + nameCells(x.body)));
    const asCsv = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    ok('in every usage CSV the formula name leaves defused, \'=HYPERLINK("http://x"), and no cell starts as a formula', csvs.length === 4
      && csvs.every((x) => x.status === 200 && x.body.includes(asCsv('\'=HYPERLINK("http://x")')) && !/(^|,)"[=+\-@\t\r]/m.test(x.body)), csvs.map((x) => x.p));
    const stored = fx.admin.raw.prepare("SELECT name FROM dir_people WHERE uid = 'UID_sample_hostile'").get().name;
    ok('(companion) and the markup name leaves as the plain text the directory holds, in every usage CSV', /^<img src=x onerror=/.test(stored) && csvs.every((x) => x.body.includes(asCsv(stored))), stored);
  }

  console.log('\n9. a journey shared with nobody leaves no trace per person (S41): her home screen and "not started" look alike');
  {
    /* A no-baby owner's home paints as her journey (pregnancy week, or cycle when trying) whether or not she
       shares it, and as Getting started when she has none (app/index.html usageScreen). One of our own
       accounts makes the same visit three ways: on the pregnancy week, on Getting started, and (the
       companion) on Settings. The first two must read the same on every page, tab and CSV. */
    const ME = { uid: S.FOUNDER_UID, hid: 'HHID_sample_founder', tz: 'Asia/Dubai', device: 'd_zzjourney001', platform: 'ios_app', app_version: 'v369', ua: S.USAGE_UA.ios, visit: 'v_zzjour01' };
    const homeVisit = (screen) => async (d1) => {
      await S.ingestVisit(d1, ME, S.NOW - 3 * 3600000, [[0, 'visit.started', { opened_from: 'icon', start: 'cold' }], [1, 'screen.viewed', { screen }],
        [130, 'visit.ended', { seconds: 130, reason: 'hidden' }]]);
    };
    const pagesFor = async (screen) => {
      const fx = await F.buildFixture({ usage: homeVisit(screen) });
      let pages = [];
      await captured(async () => { await fx.tickUntilDone(); pages = await everyPage(fx); });
      return pages;
    };
    const norm = (x) => x.replace(/datetime="[^"]*"/g, '').replace(/<time[^>]*>[^<]*<\/time>/g, '');
    const differ = (a, b) => a.filter((x, i) => norm(x.body) !== norm(b[i].body) || x.status !== b[i].status).map((x) => x.p);
    const journey = await pagesFor('pregnancy_week'), notStarted = await pagesFor('onboarding'), settings = await pagesFor('settings');
    const d = differ(journey, notStarted);
    ok('her visit on the pregnancy week and the same visit on Getting started read the same on every page, tab and CSV (' + journey.length + ' answers)', d.length === 0 && journey.length === notStarted.length, d);
    const ev = (pages) => (pages.find((x) => x.p === '/records.csv?tab=events&own=show') || {}).body || '';
    ok('and neither one names its screen: no "Getting started", no "onboarding", no pregnancy week, on any usage tab or the household page',
      ![...journey, ...notStarted].some((x) => /^\/(household\/|records(\.csv)?\?tab=(visits|events|signins|devices))/.test(x.p) && /Getting started|onboarding|pregnancy_week|Pregnancy week/.test(x.body)),
      notStarted.filter((x) => /Getting started|onboarding/.test(x.body)).map((x) => x.p));
    const c = differ(journey, settings);
    ok('(companion) the same visit on Settings DOES read differently, where a screen is shown: the Visits tab and its CSV, Usage events and its CSV, the household page',
      ['/records?tab=visits&own=show', '/records.csv?tab=visits&own=show', '/records?tab=events&own=show', '/records.csv?tab=events&own=show'].every((p) => c.includes(p))
      && c.some((p) => p.startsWith('/household/')) && /screen: settings/.test(ev(settings)), c);
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
      /* Phase 2: the one helper, and what stands behind it. */
      { name: 'the usage scope admits everyone', file: ['workers/admin/src/usage.mjs', 'workers/admin/src/usage.mjs'],
        find: ["has: (u) => uids.includes(u),", "where: (col) => col + ' IN (' + uids.map(() => '?').join(', ') + ')',"],
        replace: ['has: () => true,', "where: (col) => '(' + col + ' IS NOT NULL OR ' + col + ' IN (' + uids.map(() => '?').join(', ') + '))',"] },
      { name: 'one read forgets the scope (households measured)', file: 'workers/admin/src/usage.mjs',
        find: "const measured = await one(db, 'SELECT COUNT(DISTINCT hid) AS n FROM usage_events WHERE hid IS NOT NULL AND ' + S, U);",
        replace: "const measured = await one(db, 'SELECT COUNT(DISTINCT hid) AS n FROM usage_events WHERE hid IS NOT NULL', []);" },
      { name: 'a pregnancy screen is shown per person', file: 'workers/admin/src/usage.mjs', find: 'export const okScreen = (s) => (SCREENS.includes(s) && !hiddenPerPerson(s) ? s : null);', replace: 'export const okScreen = (s) => (SCREENS.includes(s) ? s : null);' },
      { name: 'stored props are shown as stored', file: 'workers/admin/src/usage.mjs',
        find: 'if (Object.prototype.hasOwnProperty.call(p, k) && propOk(spec.props[k], p[k]) && !hiddenPerPerson(p[k])) out.push([k, p[k]]);',
        replace: 'if (Object.prototype.hasOwnProperty.call(p, k)) out.push([k, p[k]]);' },
      { name: 'an unknown event name is shown as stored', file: 'workers/admin/src/usage.mjs', find: 'visit: okVisit(r.visit), name: props ? r.name : null,', replace: 'visit: okVisit(r.visit), name: r.name,' },
      { name: 'an OS is shown as stored', file: 'workers/admin/src/usage.mjs', find: "export const okOs = (s) => (typeof s === 'string' && /^(iOS \\d{1,2}\\.\\d{1,2}|Android \\d{1,2}|macOS|Windows|Linux)$/.test(s) ? s : 'Other');", replace: "export const okOs = (s) => String(s);" },
      { name: 'an unknown key is spelled from its own string', file: ['workers/admin/src/usage.mjs', 'workers/admin/src/views.mjs'],
        find: ['export const okFeature = (s) => (FEATURES.includes(s) && !hiddenPerPerson(s) ? s : null);', "const word = (map, k) => (k != null && Object.prototype.hasOwnProperty.call(map, k) ? map[k] : ELSE);"],
        replace: ['export const okFeature = (s) => (isJourney(s) ? null : s);', "const word = (map, k) => (k != null && Object.prototype.hasOwnProperty.call(map, k) ? map[k] : String(k));"] },
      { name: 'a screen loses its fixed label', file: 'workers/admin/src/views.mjs', find: "log_note: 'Write a note', ", replace: '' },
      /* Found green by the review of 16 Nov until §6's kick count and §8. */
      { name: 'the journey totals count her household and her', file: 'workers/admin/src/usage.mjs',
        find: "+ \"AND json_extract(props, '$.feature') = ? AND \" + scope.where('uid'), [now - 30 * DAY, r.key, ...scope.uids]);",
        replace: "+ \"AND json_extract(props, '$.feature') = ? AND (1 OR \" + scope.where('uid') + ')', [now - 30 * DAY, r.key, ...scope.uids]);" },
      { name: 'the journey note says the totals are our own accounts only', file: 'workers/admin/src/views.mjs', find: 'so their uses count everyone the server stored, not only our own accounts.', replace: 'so they count our own accounts only.' },
      { name: 'a usage tab renders the person name as markup', file: 'workers/admin/src/views.mjs', find: '  const person = w.name;', replace: '  const person = trusted(w.name);' },
      { name: 'the household visits render a name as markup', file: 'workers/admin/src/views.mjs', find: ' · ${nameOf(h, v.uid)} · ', replace: ' · ${trusted(nameOf(h, v.uid))} · ' },
      { name: 'Getting started is shown per person', file: 'workers/admin/src/usage.mjs', find: "export const PERSON_HIDDEN = Object.freeze([...JOURNEY_KEYS, 'onboarding']);", replace: 'export const PERSON_HIDDEN = Object.freeze([...JOURNEY_KEYS]);' },
      { name: 'a usage CSV leaves a formula name as a formula', file: 'workers/admin/src/index.mjs', find: "if (/^[=+\\-@\\t\\r]/.test(s)) s = \"'\" + s;", replace: '' },
    ], ok);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('ADMIN-NO-CONTENT: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); console.log('ADMIN-NO-CONTENT: FAIL'); process.exit(1); });
