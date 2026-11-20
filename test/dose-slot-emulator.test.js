/* "Log it", driven through the REAL worker.js against a REAL Firestore (the emulator).
 *
 * WHY THIS EXISTS. test/dose-membership.test.js proves the rules of /api/dose against a stubbed
 * Firestore, and a stub agrees with whoever wrote it. This repo has twice shipped a REST write a stub
 * accepted and Firestore refused (.claude/rules/ways-of-working.md). So here only Google's token
 * endpoint is faked; the household, its events, the documentId= create, the ALREADY_EXISTS on a repeat
 * and the earlier-dose runQuery (a subcollection, a range on `time`, newest first, a projection) all
 * meet the emulator.
 *
 * The story it walks is a real one: Calpol every 6 hours, the last dose given on schedule, the reminder
 * tapped 20 minutes before the next dose is due. From 2026-10-26 to 2026-11-20 that tap saved nothing
 * (docs/postmortems/2026-11-20-dose-button-saved-nothing.md).
 *
 *   node tools/gates.js --emulator-only --only=dose-emu
 *   (or FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> node test/dose-slot-emulator.test.js against a running one)
 */
const path = require('path');
const nodeCrypto = require('crypto');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); } };
const done = () => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'DOSE-EMU: FAIL' : 'DOSE-EMU: PASS');
  process.exit(fail ? 1 : 0);
};

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
if (!EMU) { console.log('  FAIL FIRESTORE_EMULATOR_HOST is not set: this test needs the Firestore emulator'); fail++; done(); }

const PROJECT = 'demo-cubby';
const HOST = 'https://little-cubby.com';
const { privateKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SA = { project_id: PROJECT, client_email: 'cubby@demo-cubby.iam.gserviceaccount.com', private_key: privateKey };
const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
const DOCS = 'http://' + EMU + '/v1/projects/' + PROJECT + '/databases/(default)/documents';
const OWNER = 'uidOwnerE', CARE = 'uidCareE', STRANGER = 'uidStrangerE';
const HR = 3600000, MIN = 60000;

const realFetch = globalThis.fetch;
const writes = {};
globalThis.fetch = async (input, init) => {
  let url = String(input && input.url ? input.url : input);
  const method = ((init && init.method) || 'GET').toUpperCase();
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://firestore.googleapis.com/')) {
    url = url.replace('https://firestore.googleapis.com/', 'http://' + EMU + '/').replace('/projects/little-log-a9caa/', '/projects/' + PROJECT + '/');
    const h = Object.assign({}, (init && init.headers) || {}, { authorization: 'Bearer owner' });
    const r = await realFetch(url, Object.assign({}, init, { headers: h }));
    if (method !== 'GET' && !/:runQuery$/.test(url)) { const k = method + ' ' + r.status; writes[k] = (writes[k] || 0) + 1; }
    return r;
  }
  throw new Error('unstubbed external call: ' + method + ' ' + url);
};

/* Firestore REST values, for seeding and reading back. */
const fv = (v) => v === null ? { nullValue: null } : typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : Array.isArray(v) ? { arrayValue: v.length ? { values: v.map(fv) } : {} }
  : { mapValue: Object.keys(v).length ? { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fv(x)])) } : {} };
const pv = (v) => !v ? undefined : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null : 'arrayValue' in v ? (v.arrayValue.values || []).map(pv)
  : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, pv(x)])) : undefined;
const H = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const put = (p, obj) => realFetch(DOCS + p, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: fv(obj).mapValue.fields }) }).then((r) => r.status);
const events = async (hid) => {
  const r = await realFetch(DOCS + '/households/' + hid + '/events?pageSize=300', { headers: H });
  const j = await r.json();
  return (j.documents || []).map((d) => Object.assign({ _id: d.name.split('/').pop() }, pv({ mapValue: { fields: d.fields } })));
};

let serial = 0;
async function family(seed) {
  const hid = 'hhDoseEmu' + process.pid + 'x' + (++serial);
  await put('/households/' + hid, {
    ownerId: OWNER, members: { [OWNER]: 'owner', [CARE]: 'caregiver' },
    app: {
      babies: [{ id: 'babyA', name: 'Ada' }, { id: 'babyB', name: 'Bo' }],
      meds: [{ id: 'medCalpol', name: 'Calpol', dose: '5', unit: 'ml', babyId: 'babyA', pattern: { type: 'everyX', hours: 6 } },
             { id: 'medIbu', name: 'Ibuprofen', dose: 2.5, unit: 'ml', pattern: { type: 'daily', times: ['08:00', '20:00'] } }]
    }
  });
  for (const e of seed || []) await put('/households/' + hid + '/events/' + e.id, e);
  return hid;
}

(async () => {
  console.log('\n"Log it" against the Firestore emulator at ' + EMU + '\n');
  const mod = await import('file://' + path.join(__dirname, '..', 'worker.js'));
  const tap = async (hid, claims) => {
    const n = await mod.__dose.mintDoseTicket(SA, Object.assign({ h: hid, m: 'medCalpol', b: 'babyA' }, claims));
    const res = await mod.default.fetch(new Request(HOST + '/api/dose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ n }) }), ENV, { waitUntil() {} });
    let body = null; try { body = await res.json(); } catch (e) {}
    return { status: res.status, body };
  };
  const NOW = Date.now(), T = NOW + 20 * MIN;
  const sched = (o) => Object.assign({ id: 'evSched', type: 'medicine', medId: 'medCalpol', babyId: 'babyA', time: T - 6 * HR, authorId: OWNER }, o);

  console.log('1. every 6h, last dose on schedule, tapped 20 minutes early');
  const hid = await family([sched({})]);
  let r = await tap(hid, { u: CARE, t: T });
  ok('the route answers ok, with no "already" and no earlier dose', r.status === 200 && r.body && r.body.ok === true && !r.body.already && !r.body.earlier, r);
  let ev = await events(hid);
  const mine = ev.find((e) => e._id === 'dose-medCalpol-' + T + '-' + CARE);
  ok('and the dose is really in Firestore, under this dose and this person', !!mine, ev.map((e) => e._id));
  ok('as the family\'s Calpol, for Ada, by the caregiver, via the notification',
     !!mine && mine.medName === 'Calpol' && mine.dose === '5' && mine.unit === 'ml' && mine.babyId === 'babyA' && mine.authorId === CARE && mine.via === 'notification' && mine.type === 'medicine', mine);

  console.log('\n2. the same person taps again');
  r = await tap(hid, { u: CARE, t: T });
  ok('Firestore refuses the repeat (ALREADY_EXISTS) and the route says "already"', r.status === 200 && r.body && r.body.ok === true && r.body.already === true, r);
  ev = await events(hid);
  ok('still one dose from this person for this reminder', ev.filter((e) => e.via === 'notification' && e.authorId === CARE).length === 1, ev.map((e) => e._id));

  console.log('\n3. the other parent taps the same reminder');
  r = await tap(hid, { u: OWNER, t: T });
  ev = await events(hid);
  const theirs = ev.find((e) => e._id === 'dose-medCalpol-' + T + '-' + OWNER);
  ok('their dose is saved too, under their own id', r.status === 200 && r.body && r.body.ok === true && !!theirs, [r, ev.map((e) => e._id)]);
  ok('and they are told about the first one: the earlier-dose query really ran on Firestore', !!r.body && !!mine && r.body.earlier === mine.time, [r.body, mine && mine.time]);

  console.log('\n4. twice daily, the last slot given three hours late, tapped 20 minutes early');
  const hid2 = await family([sched({ id: 'evLate', medId: 'medIbu', babyId: 'babyB', time: T - 9 * HR })]);
  r = await tap(hid2, { u: OWNER, t: T, m: 'medIbu', b: 'babyB' });
  ok('saved, with no earlier dose: that was the last slot\'s', r.status === 200 && r.body && r.body.ok === true && !r.body.earlier && (await events(hid2)).length === 2, r);

  console.log('\n5. a stranger, on the real store');
  r = await tap(hid, { u: STRANGER, t: T });
  ev = await events(hid);
  ok('401, and nothing of theirs in Firestore', r.status === 401 && !ev.some((e) => e.authorId === STRANGER), [r, ev.map((e) => e._id)]);

  console.log('\n   writes seen: ' + JSON.stringify(writes));
  done();
})().catch((e) => { console.error(e); fail++; done(); });
