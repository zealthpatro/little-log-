/* The purge cron's second lock, driven through the REAL worker.js against a REAL Firestore (the emulator).
 *
 * purgeDeletedHouseholds refuses to erase a household that still has people in it, and clears the
 * bogus deletion flag instead (a flagged household gets no medicine reminders). The first version of
 * that clear sent its precondition in the query string (?currentDocument.updateTime=), which the
 * emulator reads as base version 0 and refuses: the family was spared but the flag never cleared.
 * test/purge-guard.test.js stubs fetch, so it could not see that. This one lets Firestore decide.
 *
 *   cd test && npx firebase-tools emulators:exec --only firestore --project demo-cubby 'node purge-unflag-emulator.test.js'
 */
const path = require('path');
const nodeCrypto = require('crypto');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const done = () => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PURGE-UNFLAG-EMU: FAIL' : 'PURGE-UNFLAG-EMU: PASS');
  process.exit(fail ? 1 : 0);
};

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
if (!EMU) { console.log('  FAIL FIRESTORE_EMULATOR_HOST is not set: this test needs the Firestore emulator'); fail++; done(); }
const ROOT = path.join(__dirname, '..');
const PROJECT = 'demo-cubby';
const DOCS = 'http://' + EMU + '/v1/projects/' + PROJECT + '/databases/(default)/documents';
const { privateKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SA = { project_id: PROJECT, client_email: 'cubby@demo-cubby.iam.gserviceaccount.com', private_key: privateKey };

const realFetch = globalThis.fetch;
const ADMIN = { authorization: 'Bearer owner' };
let beforeCommit = null;   // section 2: something writes the household between the read and the clear
const writes = [];
globalThis.fetch = async (input, init) => {
  let url = String(input && input.url ? input.url : input);
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
  if (!url.startsWith('https://firestore.googleapis.com/v1/')) throw new Error('unexpected fetch ' + url);
  url = url.replace('https://firestore.googleapis.com/v1/', 'http://' + EMU + '/v1/').replace('/projects/little-log-a9caa/', '/projects/' + PROJECT + '/');
  const method = ((init && init.method) || 'GET').toUpperCase();
  if (/:commit$/.test(url) && beforeCommit) { const f = beforeCommit; beforeCommit = null; await f(); }
  const r = await realFetch(url, Object.assign({}, init, { headers: Object.assign({}, (init && init.headers) || {}, ADMIN) }));
  if (method !== 'GET' && !/:runQuery$/.test(url)) writes.push(method + ' ' + (url.split('/documents')[1] || '') + ' ' + r.status);
  return r;
};
const put = (id, fields) => realFetch(DOCS + '/households/' + id, { method: 'PATCH', headers: Object.assign({ 'content-type': 'application/json' }, ADMIN), body: JSON.stringify({ fields }) });
const get = async (id) => { const r = await realFetch(DOCS + '/households/' + id, { headers: ADMIN }); return r.ok ? (await r.json()).fields : null; };
const due = () => ({ integerValue: String(Date.now() - 1000) });
const people = { mapValue: { fields: { u1: { stringValue: 'owner' }, u2: { stringValue: 'caregiver' } } } };
const appBlob = { mapValue: { fields: { babies: { stringValue: 'kept' } } } };

(async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'worker.js')).href);
  const purge = mod.__purge && mod.__purge.purgeDeletedHouseholds;
  ok('worker.js exports __purge.purgeDeletedHouseholds', typeof purge === 'function');
  if (typeof purge !== 'function') done();
  const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
  const logs = []; const origErr = console.error, origLog = console.log;

  console.log('\n1. a caregiver flagged a family that still has people in it');
  await put('hhAttacked', { deleteAfter: due(), deletionRequestedBy: { stringValue: 'u2' }, members: people, app: appBlob });
  await put('hhLegit', { deleteAfter: due(), members: { mapValue: { fields: {} } } });
  console.error = (...a) => logs.push(a.join(' '));
  const res = await purge(ENV);
  console.error = origErr;
  const a = await get('hhAttacked');
  ok('the family is still there', !!a);
  ok('with its people and its log', !!a && !!a.members && !!a.app && a.app.mapValue.fields.babies.stringValue === 'kept', a);
  ok('and the bogus flag is gone, so its medicine reminders run again', !!a && !a.deleteAfter && !a.deletionRequestedBy, a && Object.keys(a));
  ok('Firestore accepted the clear (no purge_unflag_fail)', !logs.some((l) => /purge_unflag_fail/.test(l)), logs);
  ok('the household whose last member left is purged as before', !(await get('hhLegit')) && res && res.households === 1, res);

  console.log('\n2. the family changes between the read and the clear');
  await put('hhRace', { deleteAfter: due(), deletionRequestedBy: { stringValue: 'u2' }, members: people, app: appBlob });
  beforeCommit = () => put('hhRace', { deleteAfter: due(), deletionRequestedBy: { stringValue: 'u2' }, members: people, app: { mapValue: { fields: { babies: { stringValue: 'newer' } } } } });
  logs.length = 0;
  console.error = (...a) => logs.push(a.join(' '));
  await purge(ENV);
  console.error = origErr;
  const r = await get('hhRace');
  ok('the precondition is real: the clear is refused, so a newer write is never overwritten', !!r && !!r.deleteAfter && logs.some((l) => /purge_unflag_fail/.test(l)), { keys: r && Object.keys(r), logs });
  ok('and the family is still not purged', !!r && !!r.members && r.app.mapValue.fields.babies.stringValue === 'newer', r && Object.keys(r));
  const r2 = await purge(ENV) && await get('hhRace');
  ok('the next tick clears it', !!r2 && !r2.deleteAfter && !r2.deletionRequestedBy, r2 && Object.keys(r2));
  void origLog;
  done();
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); fail++; done(); });
