/* Who may log a dose from a notification. The question test/dose-ticket.test.js never asked.
 *
 * dose-ticket proves a ticket cannot be forged or edited. It stayed green through a hole that needed
 * neither: users/{uid} is writable by its owner, so anyone signed in could set their own householdId
 * to a family they do not belong to (a removed caregiver, anyone who once held an invite link), add a
 * push.due entry naming any medicine, and the cron would mint them a perfectly genuine ticket. The
 * redeem route checked the signature and nothing else, so the ticket wrote a medicine event into
 * that family's record as the stranger, bypassing the events rule (uid in members) entirely. And a
 * removed member kept receiving reminders that named the child's medicines.
 *
 * The rule now, on both halves:
 *   mint   - the cron reads households/{hid}.members fresh and sends nothing to anyone who is not an
 *            owner or caregiver of a household that is not being deleted.
 *   redeem - /api/dose re-reads the household and refuses the same people, takes the medicine's name,
 *            dose and unit from app.meds (never from the ticket), refuses a dose already given inside
 *            the medicine's interval, is rate limited, and writes NOTHING when any read fails.
 *
 * Not a mirror. This imports the real worker.js and drives the real cron and the real fetch handler
 * against a fake Firestore that honours field masks, so a check that reads a field it never asked for
 * fails here the way it would in production.
 *
 *   node test/dose-membership.test.js
 *   node test/dose-membership.test.js --self-test   (re-run against broken copies of worker.js and
 *                                                    require each break to be caught)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateKeyPairSync } = require('crypto');

const SELF = process.argv.includes('--self-test');
const ROOT = path.join(__dirname, '..');
const say = console.log.bind(console);

const DOCS = 'https://firestore.googleapis.com/v1/projects/little-log-a9caa/databases/(default)/documents';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { client_email: 'cron@little-log-a9caa.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };

/* ---- Firestore REST values, both directions ---------------------------------------------------- */
function fv(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(fv) } : {} };
  return { mapValue: Object.keys(v).length ? { fields: fmap(v) } : {} };
}
const fmap = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fv(x)]));
function pv(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(pv);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, pv(x)]));
  return undefined;
}
/* A DocumentMask, applied the way Firestore applies it: only the named paths come back. */
function masked(obj, paths) {
  if (!paths.length) return obj;
  const out = {};
  for (const p of paths) {
    const segs = p.split('.');
    let src = obj, ok = true;
    for (const s of segs) { if (src && typeof src === 'object' && s in src) src = src[s]; else { ok = false; break; } }
    if (!ok) continue;
    let dst = out;
    segs.slice(0, -1).forEach((s) => { dst[s] = dst[s] || {}; dst = dst[s]; });
    dst[segs[segs.length - 1]] = src;
  }
  return out;
}

/* ---- The family ------------------------------------------------------------------------------- */
const HID = 'hhVictim0001';
const OWNER = 'uidOwner01', CARE = 'uidCare01', STRANGER = 'uidStranger1', REMOVED = 'uidRemoved1', ODDROLE = 'uidOddRole1';
const CALPOL = { id: 'medCalpol', name: 'Calpol', dose: '5', unit: 'ml', babyId: 'babyA', remind: true, pattern: { type: 'everyX', hours: 6 } };
const IBU = { id: 'medIbu', name: 'Ibuprofen', dose: 2.5, unit: 'ml', remind: true, pattern: { type: 'daily', times: ['08:00', '20:00'] } };
const household = (extra) => Object.assign({
  ownerId: OWNER,
  members: { [OWNER]: 'owner', [CARE]: 'caregiver', [ODDROLE]: 'guest' },
  memberInfo: { [OWNER]: { name: 'Sam' }, [CARE]: { name: 'Gran' } },
  formerMemberInfo: { [REMOVED]: { name: 'Ex' } },
  app: { babies: [{ id: 'babyA', name: 'Ada' }, { id: 'babyB', name: 'Bo' }], meds: [CALPOL, IBU], settings: {} }
}, extra || {});

/* ---- A fake Google: token endpoint, Firestore REST, FCM ------------------------------------------ */
function makeWorld(o) {
  o = o || {};
  const w = {
    households: o.households || { [HID]: household() },   // value 'error' = a 503 on read
    users: o.users || [],
    events: o.events || [],
    eventsStatus: o.eventsStatus || 200,
    writes: [], fcm: [], patches: [], hhReads: [], eventQueries: [], unexpected: [], calls: 0, logs: []
  };
  w.fetch = async (input, init) => {
    init = init || {};
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    w.calls++;
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status,
      json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (url === TOKEN_URL) return reply(200, { access_token: 'tok-test' });
    if (url.startsWith('https://fcm.googleapis.com/')) { w.fcm.push(JSON.parse(init.body).message); return reply(200, {}); }
    if (!url.startsWith(DOCS)) { w.unexpected.push(method + ' ' + url); throw new Error('unexpected fetch ' + url); }
    const rest = url.slice(DOCS.length);

    if (rest === ':runQuery' && method === 'POST') return reply(200, w.users.map((d) => ({ document: d })));

    let m = rest.match(/^\/households\/([^/?:]+):runQuery$/);
    if (m && method === 'POST') {
      const sq = JSON.parse(init.body).structuredQuery;
      w.eventQueries.push({ hid: decodeURIComponent(m[1]), sq });
      if (w.eventsStatus !== 200) return reply(w.eventsStatus, 'UNAVAILABLE');
      let evs = w.events.slice();
      const ff = sq && sq.where && sq.where.fieldFilter;
      if (ff && ff.field.fieldPath === 'time') {
        const lim = Number(pv(ff.value));
        if (ff.op === 'GREATER_THAN_OR_EQUAL') evs = evs.filter((e) => e.time >= lim);
        else if (ff.op === 'GREATER_THAN') evs = evs.filter((e) => e.time > lim);
      }
      const docs = evs.map((e) => ({ document: { name: DOCS + '/households/' + HID + '/events/' + e.id, fields: fmap(e) } }));
      return reply(200, docs.length ? docs : [{ readTime: new Date().toISOString() }]);
    }

    m = rest.match(/^\/households\/([^/?]+)\/events\?documentId=(.+)$/);
    if (m && method === 'POST') {
      w.writes.push({ hid: decodeURIComponent(m[1]), docId: decodeURIComponent(m[2]), fields: pv({ mapValue: JSON.parse(init.body) }) });
      return reply(200, {});
    }

    m = rest.match(/^\/households\/([^/?]+)(?:\?(.*))?$/);
    if (m && method === 'GET') {
      const hid = decodeURIComponent(m[1]);
      const mask = new URLSearchParams(m[2] || '').getAll('mask.fieldPaths');
      w.hhReads.push({ hid, mask });
      const hh = w.households[hid];
      if (hh === 'error') return reply(503, 'UNAVAILABLE');
      if (!hh) return reply(404, { error: { code: 404, status: 'NOT_FOUND' } });
      return reply(200, { name: DOCS + '/households/' + hid, fields: fmap(masked(hh, mask)) });
    }

    m = rest.match(/^\/users\/([^/?]+)\?/);
    if (m && method === 'PATCH') {
      w.patches.push({ uid: decodeURIComponent(m[1]), fields: pv({ mapValue: JSON.parse(init.body) }) });
      return reply(200, {});
    }
    if (rest.startsWith('/campaigns?') && method === 'GET') return reply(200, { documents: [] });

    w.unexpected.push(method + ' ' + url);
    throw new Error('unexpected fetch ' + method + ' ' + url);
  };
  return w;
}

/* Run one worker call inside a world, with the Worker's own logging captured instead of printed. */
async function inWorld(w, fn) {
  const realFetch = globalThis.fetch, realLog = console.log, realErr = console.error;
  globalThis.fetch = w.fetch;
  console.log = (...a) => w.logs.push(a.join(' '));
  console.error = (...a) => w.logs.push(a.join(' '));
  try { return await fn(); }
  finally { globalThis.fetch = realFetch; console.log = realLog; console.error = realErr; }
}

const ENV = (extra) => Object.assign({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) }, extra || {});

/* ---- The suite. Takes a loaded worker module so --self-test can hand it a broken one. ---------- */
async function suite(mod, quiet) {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => {
    if (c) { pass++; if (!quiet) say('  ok   ' + n); }
    else { fail++; if (!quiet) say('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); }
  };
  const head = (s) => { if (!quiet) say('\n' + s); };
  const dose = mod.__dose;
  if (!dose || typeof dose.sendPushReminders !== 'function' || typeof dose.mintDoseTicket !== 'function') {
    ok('worker.js exports __dose.{sendPushReminders,mintDoseTicket}, so this can be tested at all', false);
    return { pass, fail };
  }
  const NOW = Date.now();
  const MIN = 60000, HR = 3600000;

  /* -------------------------------------------------------------------------------------------- */
  /* Mint side: the cron. Each user has a pre-dose reminder that fired a minute ago for a dose due  */
  /* in 20 minutes, plus this morning's digest. The reminder names a medicine the attacker chose.  */
  const DUE_AT = NOW + 20 * MIN;
  const dueFor = () => [
    { at: NOW - MIN, due: DUE_AT, cat: 'critical', title: 'Poison soon', body: 'Time for Poison 50 tablets', tag: 'med-medCalpol-' + DUE_AT,
      medId: 'medCalpol', babyId: 'babyA', medName: 'Poison', dose: '50', unit: 'tablets', iv: 6 * HR },
    { at: NOW - 2 * MIN, cat: 'critical', title: 'Today with Ada', body: 'Medicines today: Calpol, Ibuprofen', tag: 'digest-1' }
  ];
  const userDoc = (uid, hid, due) => {
    const f = { push: { enabled: true, tokens: { ['tok-' + uid]: { at: 1 } }, due: due || dueFor(), nextAt: NOW - 2 * MIN } };
    if (hid !== undefined) f.householdId = hid;
    return { name: DOCS + '/users/' + uid, fields: fmap(f) };
  };
  const cron = async (w) => inWorld(w, () => dose.sendPushReminders(ENV()));
  const sentTo = (w, uid) => w.fcm.filter((msg) => msg.token === 'tok-' + uid);

  head('1. the cron still reaches the family (control: proves the fake Google really delivers)');
  {
    const w = makeWorld({ users: [userDoc(OWNER, HID), userDoc(CARE, HID)] });
    await cron(w);
    ok('the owner gets the dose reminder and the digest', sentTo(w, OWNER).length === 2, sentTo(w, OWNER).length);
    ok('the caregiver gets them too', sentTo(w, CARE).length === 2, sentTo(w, CARE).length);
    ok('and the dose reminder carries a ticket', sentTo(w, OWNER).some((msg) => msg.data && msg.data.nonce));
    ok('nothing unexpected was fetched', w.unexpected.length === 0, w.unexpected);
  }

  head('2. a stranger who points their own user doc at this family gets nothing');
  {
    const w = makeWorld({ users: [userDoc(STRANGER, HID)] });
    await cron(w);
    ok('no notification at all, so no ticket and no medicine names', sentTo(w, STRANGER).length === 0, sentTo(w, STRANGER).map((msg) => msg.notification));
    ok('the household was read to decide that', w.hhReads.some((r) => r.hid === HID));
    ok('and the refusal moves the cursor, so they are not re-read on every tick forever',
       w.patches.some((p) => p.uid === STRANGER && p.fields.push && p.fields.push.sentUpTo >= NOW - MIN), w.patches);
  }

  head('3. nor does anyone else who is not an owner or caregiver of a live household');
  {
    let w = makeWorld({ users: [userDoc(REMOVED, HID)] });
    await cron(w);
    ok('a removed caregiver stops hearing the child\'s medicines named', sentTo(w, REMOVED).length === 0);

    w = makeWorld({ users: [userDoc(ODDROLE, HID)] });
    await cron(w);
    ok('a members entry with any other role is not enough', sentTo(w, ODDROLE).length === 0);

    w = makeWorld({ users: [userDoc(OWNER, HID)], households: { [HID]: household({ deleteAfter: NOW + 30 * 24 * HR }) } });
    await cron(w);
    ok('a household flagged for deletion sends nothing', sentTo(w, OWNER).length === 0);

    w = makeWorld({ users: [userDoc(STRANGER, 'hhDoesNotExist')] });
    await cron(w);
    ok('a household that does not exist sends nothing', sentTo(w, STRANGER).length === 0);

    w = makeWorld({ users: [userDoc(STRANGER, HID + '/events/x')] });
    await cron(w);
    ok('a householdId shaped like a path sends nothing', sentTo(w, STRANGER).length === 0);
    ok('and is never used to address a read', !w.hhReads.some((r) => r.hid.includes('/')), w.hhReads);

    w = makeWorld({ users: [userDoc(STRANGER)] });
    await cron(w);
    ok('no householdId at all sends nothing', sentTo(w, STRANGER).length === 0);
  }

  head('4. a failed read fails closed, and is retried rather than lost');
  {
    const w = makeWorld({ users: [userDoc(OWNER, HID)], households: { [HID]: 'error' } });
    await cron(w);
    ok('a 503 on the household sends nothing', sentTo(w, OWNER).length === 0);
    ok('and does NOT advance the cursor, so the next tick tries again',
       !w.patches.some((p) => p.uid === OWNER && p.fields.push && p.fields.push.sentUpTo >= NOW - 2 * MIN), w.patches);
    const run = w.logs.find((l) => l.startsWith('push_run'));
    ok('and is counted as failed, so /api/health can see it', !!run && JSON.parse(run.slice('push_run '.length)).failed > 0, run);
  }

  head('5. what the check costs');
  {
    let w = makeWorld({ users: [userDoc(OWNER, HID)] });
    await cron(w);
    const mine = w.hhReads.filter((r) => r.hid === HID);
    ok('one household read per user per tick, not one per message', mine.length === 1, mine.length);
    ok('masked to members and deleteAfter, so the app blob is never pulled for this',
       mine.length === 1 && mine[0].mask.slice().sort().join(',') === 'deleteAfter,members', mine[0] && mine[0].mask);

    const stale = [{ at: NOW - 50 * MIN, due: NOW - 5 * MIN, cat: 'critical', title: 't', body: 'b', tag: 'med-x-1', medId: 'medCalpol', babyId: 'babyA' }];
    w = makeWorld({ users: [userDoc(OWNER, HID, stale)] });
    await cron(w);
    ok('a user with nothing left to send costs no household read', w.hhReads.length === 0, w.hhReads.length);
  }

  /* -------------------------------------------------------------------------------------------- */
  /* Redeem side. Tickets are minted directly: one minted before this fix shipped stays valid for */
  /* six hours after its dose, so the route has to stand on its own whatever the cron now does.  */
  const T = NOW + 20 * MIN;
  const claims = (o) => Object.assign({ u: CARE, h: HID, m: 'medCalpol', b: 'babyA', mn: 'Poison', d: '50', n: 'tablets', t: T, i: 6 * HR }, o || {});
  const redeem = async (w, c, env, raw) => inWorld(w, async () => {
    const n = raw !== undefined ? raw : await dose.mintDoseTicket(SA, claims(c));
    const req = new Request('https://little-cubby.com/api/dose', {
      method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' }, body: JSON.stringify({ n })
    });
    const res = await mod.default.fetch(req, env || ENV(), { waitUntil() {} });
    let body = null; try { body = await res.json(); } catch (e) {}
    return { status: res.status, body };
  });

  head('6. the redeem route refuses anyone who is not a current owner or caregiver');
  for (const [name, c, hh] of [
    ['a stranger', { u: STRANGER }],
    ['a removed caregiver', { u: REMOVED }],
    ['a members entry with any other role', { u: ODDROLE }],
    ['an owner of a household flagged for deletion', { u: OWNER }, household({ deleteAfter: NOW + 30 * 24 * HR })]
  ]) {
    const w = makeWorld(hh ? { households: { [HID]: hh } } : {});
    const r = await redeem(w, c);
    ok(name + ': writes nothing', w.writes.length === 0, w.writes.map((x) => x.fields.medName));
    ok(name + ': and says only that the ticket did not work', r.status === 401 && r.body && r.body.error === 'bad_ticket', r);
  }

  head('7. and refuses a medicine or child this family does not have');
  for (const [name, c] of [
    ['a medicine that is not in app.meds', { m: 'medGone' }],
    ['a child who is not in app.babies', { b: 'babyZ' }],
    ['a medicine pinned to one child, logged against the other', { b: 'babyB' }]
  ]) {
    const w = makeWorld();
    const r = await redeem(w, c);
    ok(name + ': writes nothing', w.writes.length === 0, w.writes);
    ok(name + ': 401', r.status === 401, r);
  }
  {
    const w = makeWorld({ households: {} });
    const r = await redeem(w, {});
    ok('a household that does not exist writes nothing, 401', w.writes.length === 0 && r.status === 401, r);
  }

  head('8. a read that fails writes nothing');
  {
    let w = makeWorld({ households: { [HID]: 'error' } });
    let r = await redeem(w, {});
    ok('household read 503: no write', w.writes.length === 0, w.writes);
    ok('household read 503: says so with a 503, not a 401 the device would treat as final', r.status === 503, r);

    w = makeWorld({ eventsStatus: 503 });
    r = await redeem(w, {});
    ok('already-logged query 503: no write', w.writes.length === 0, w.writes);
    ok('already-logged query 503: 503', r.status === 503, r);
  }

  head('9. the family\'s own medicine is what gets written, never what the ticket says');
  {
    let w = makeWorld();
    let r = await redeem(w, {});
    const x = w.writes[0];
    ok('a caregiver logs exactly one dose', w.writes.length === 1 && r.status === 200 && r.body && r.body.ok === true, r);
    ok('into this family, at the deterministic id', x && x.hid === HID && x.docId === 'dose-medCalpol-' + T, x && [x.hid, x.docId]);
    ok('medName from app.meds, not the ticket', x && x.fields.medName === 'Calpol', x && x.fields.medName);
    ok('dose from app.meds', x && x.fields.dose === '5', x && x.fields.dose);
    ok('unit from app.meds', x && x.fields.unit === 'ml', x && x.fields.unit);
    ok('authored by the member who tapped', x && x.fields.authorId === CARE, x && x.fields.authorId);
    ok('for the right child, as a medicine, via the notification',
       x && x.fields.babyId === 'babyA' && x.fields.type === 'medicine' && x.fields.via === 'notification' && x.fields.medId === 'medCalpol');
    ok('the household read asked for exactly what the check needs',
       w.hhReads.length === 1 && w.hhReads[0].mask.slice().sort().join(',') === 'app.babies,app.meds,deleteAfter,members', w.hhReads[0] && w.hhReads[0].mask);

    w = makeWorld();
    r = await redeem(w, { u: OWNER, m: 'medIbu', b: 'babyB', mn: 'Poison', d: '99', n: 'g' });
    const y = w.writes[0];
    ok('an unpinned medicine logs for the child the ticket names, if that child is in the family',
       y && y.fields.babyId === 'babyB' && y.fields.medName === 'Ibuprofen', y && y.fields);
    ok('a numeric dose comes through as the family wrote it', y && y.fields.dose === '2.5' && y.fields.unit === 'ml', y && y.fields);
  }

  head('10. a dose already given inside the interval is not given again');
  {
    const ev = (o) => Object.assign({ id: 'e' + Math.random().toString(36).slice(2, 8), type: 'medicine', medId: 'medCalpol', babyId: 'babyA', time: NOW - HR, authorId: OWNER }, o);
    let w = makeWorld({ events: [ev({})] });
    let r = await redeem(w, {});
    ok('Calpol logged in the app an hour ago (every 6h): nothing written', w.writes.length === 0, w.writes);
    ok('and the device is told it is already logged', r.status === 200 && r.body && r.body.ok === true && r.body.already === true, r);
    ok('the query asked only for this household\'s events', w.eventQueries.length === 1 && w.eventQueries[0].hid === HID, w.eventQueries.map((q) => q.hid));

    w = makeWorld({ events: [ev({ medId: 'medIbu', babyId: 'babyB', time: NOW - 11 * HR })] });
    r = await redeem(w, { u: OWNER, m: 'medIbu', b: 'babyB' });
    ok('a twice-daily medicine 11h after its last dose: nothing written (its interval is 12h)', w.writes.length === 0 && r.body && r.body.already === true, r);

    /* The companions. Each one STAGES a near-miss and requires the write, so the check above cannot
       pass by refusing everything. */
    for (const [name, o, c] of [
      ['the last dose was 7h ago, outside 6h', { time: NOW - 7 * HR }],
      ['the last dose was the other child\'s', { babyId: 'babyB' }],
      ['the last dose was deleted', { deleted: true }],
      ['the recent dose was a different medicine', { medId: 'medIbu' }],
      ['the "recent" dose is dated in the future', { time: NOW + 2 * HR }],
      ['a twice-daily medicine 13h after its last dose', { medId: 'medIbu', babyId: 'babyB', time: NOW - 13 * HR }, { u: OWNER, m: 'medIbu', b: 'babyB' }]
    ]) {
      w = makeWorld({ events: [ev(o)] });
      r = await redeem(w, c || {});
      ok('but ' + name + ': the dose is written', w.writes.length === 1 && r.body && r.body.ok === true && !r.body.already, [w.writes.length, r]);
    }

    /* The query is capped. A full page with no match is not proof there is no match further back, so
       it must fail closed rather than write. 500 feeds in the last six hours, none of them Calpol. */
    const feeds = Array.from({ length: 500 }, (_, k) => ev({ type: 'feed', medId: '', time: NOW - (k + 1) * 30000 }));
    w = makeWorld({ events: feeds });
    r = await redeem(w, {});
    ok('a full page of other events cannot prove absence: 503, nothing written', r.status === 503 && w.writes.length === 0, [r.status, w.writes.length]);
    w = makeWorld({ events: feeds.slice(0, 499) });
    r = await redeem(w, {});
    ok('one short of a full page is a real answer: the dose is written', r.status === 200 && w.writes.length === 1, [r.status, w.writes.length]);
  }

  head('11. it is rate limited before it costs anything');
  {
    const keys = [];
    let w = makeWorld();
    let r = await redeem(w, {}, ENV({ DOSE_RATE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } }));
    ok('over the limit: 429', r.status === 429, r);
    ok('and nothing was read or written, not even a token', w.calls === 0 && w.writes.length === 0, w.calls);
    ok('keyed per IP under its own prefix', keys[0] === 'dose:203.0.113.7', keys);

    w = makeWorld();
    r = await redeem(w, {}, ENV({ SIGNIN_RATE_LIMITER: { limit: async () => ({ success: false }) } }));
    ok('falls back to the sign-in limiter when the binding is missing', r.status === 429 && w.writes.length === 0, r);

    w = makeWorld();
    r = await redeem(w, {}, ENV({ DOSE_RATE_LIMITER: { limit: async () => ({ success: true }) } }));
    ok('under the limit it logs as normal', r.status === 200 && w.writes.length === 1, r);
  }

  head('12. the old guarantees still hold');
  {
    let w = makeWorld();
    let r = await redeem(w, {}, null, 'v1.not.real');
    ok('a forged ticket: 401 and no Firestore traffic at all', r.status === 401 && w.writes.length === 0 && w.hhReads.length === 0, r);
    w = makeWorld({ events: [] });
    w.fetch = ((inner) => async (u, init) => {
      if (typeof u === 'string' && /\/events\?documentId=/.test(u)) { w.calls++; return { ok: false, status: 409, text: async () => 'ALREADY_EXISTS' }; }
      return inner(u, init);
    })(w.fetch);
    r = await redeem(w, {});
    ok('ALREADY_EXISTS from a double tap is still success', r.status === 200 && r.body && r.body.already === true, r);
  }

  return { pass, fail };
}

/* ---- Main ------------------------------------------------------------------------------------- */
(async () => {
  say('\ndose membership: who may log a dose from a notification');
  const real = await import('file://' + path.join(ROOT, 'worker.js'));
  const r = await suite(real, false);
  let pass = r.pass, fail = r.fail;
  const ok = (n, c, x) => { if (c) { pass++; say('  ok   ' + n); } else { fail++; say('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };

  say('\n13. the config and the wiring');
  {
    const toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
    const block = (toml.match(/\[\[unsafe\.bindings\]\]\s*\nname = "DOSE_RATE_LIMITER"\s*\ntype = "ratelimit"\s*\nnamespace_id = "(\d+)"\s*\nsimple = \{ limit = (\d+), period = (\d+) \}/) || []);
    ok('wrangler.toml declares DOSE_RATE_LIMITER as a ratelimit binding', !!block[1], block[0]);
    const ids = [...toml.matchAll(/^namespace_id = "(\d+)"/gm)].map((x) => x[1]);
    ok('with a namespace_id no other limiter uses', !!block[1] && ids.filter((i) => i === block[1]).length === 1, ids);
    ok('and a period the platform accepts (10 or 60)', block[3] === '10' || block[3] === '60', block[3]);
    const gates = fs.readFileSync(path.join(ROOT, 'tools', 'gates.js'), 'utf8');
    ok('tools/gates.js runs this file with --self-test', /cmd: \['node', 'test\/dose-membership\.test\.js', '--self-test'\]/.test(gates));
  }

  /* --self-test: every check above is only worth its runtime if it can fail. Each mutant re-breaks
     one load-bearing line of worker.js in a temp copy, and the suite must go red against it. A
     mutant whose anchor text is gone also fails, so this cannot quietly stop testing anything. */
  if (SELF) {
    say('\n14. --self-test: each break is caught');
    const SRC = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8')
      .replace("from './workers/funnel/core.mjs'", "from '" + 'file://' + path.join(ROOT, 'workers', 'funnel', 'core.mjs') + "'");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dose-membership-'));
    const MUTANTS = [
      ['the cron sends to anyone again', 'if (gate !== \'member\') {', 'if (false) {'],
      ['the cron treats a failed read as "not a member" (drops instead of retrying)', "if (gate === 'error') { failed++; stuck = true; continue; }", "if (gate === 'error') { dropped++; if (!stuck) maxAt = msg.at; continue; }"],
      ['the cron reads the household once per message', 'if (gate == null) gate = await pushGate(', 'if (true) gate = await pushGate('],
      ['the redeem route stops checking membership', 'if (!_isCarer(hf, c.u)) return json({ error: \'bad_ticket\' }, 401);', ''],
      ['the redeem route ignores deleteAfter', "if (hf.deleteAfter) return json({ error: 'bad_ticket' }, 401);", ''],
      ['the medicine name comes from the ticket again', "medName: { stringValue: _fsScalar(med.name) || 'Medicine' },", "medName: { stringValue: String(c.mn || 'Medicine') },"],
      ['the child pinned on a medicine is ignored', 'if (medBaby && medBaby !== String(c.b)) return json({ error: \'bad_ticket\' }, 401);', ''],
      ['a failed household read is read as "no such household"', "if (hh.status !== 404) return json({ error: 'unavailable' }, 503);", ''],
      ['the already-logged check is skipped', 'if (prior) return json({ ok: true, already: true, at: prior });', ''],
      ['the already-logged check ignores which child', "&& _fsStr(f.babyId) === String(c.b)", ''],
      ['a full page of events is read as proof of absence', "if (recent.docs.length >= DOSE_RECENT_LIMIT) return json({ error: 'unavailable' }, 503);", ''],
      ['the already-logged query failing is ignored', "if (!recent.ok) return json({ error: 'unavailable' }, 503);", "if (!recent.ok) recent.docs = [];"],
      ['the rate limiter is gone', "const limiter = env.DOSE_RATE_LIMITER || env.SIGNIN_RATE_LIMITER;", 'const limiter = null;'],
      ['the household mask stops asking for app.meds', "['members', 'deleteAfter', 'app.meds', 'app.babies']", "['members', 'deleteAfter', 'app.babies']"]
    ];
    let i = 0;
    for (const [name, find, repl] of MUTANTS) {
      const found = SRC.includes(find);
      if (!found) { ok('catches: ' + name + ' (anchor still present in worker.js)', false, find); continue; }
      const file = path.join(dir, 'worker-mut-' + (i++) + '.mjs');
      fs.writeFileSync(file, SRC.split(find).join(repl));
      let caught = false;
      try { const m = await import('file://' + file); const res = await suite(m, true); caught = res.fail > 0; }
      catch (e) { caught = false; say('    (mutant failed to load: ' + (e && e.message) + ')'); }
      ok('catches: ' + name, caught);
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }

  say('\n' + pass + ' passed, ' + fail + ' failed');
  say(fail ? 'DOSE-MEMBERSHIP: FAIL' : 'DOSE-MEMBERSHIP: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
