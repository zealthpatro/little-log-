/* The account-deletion purge really erases EVERYTHING under a household, driven through the REAL
 * worker.js against a REAL Firestore (the emulator).
 *
 * WHY THIS EXISTS (round-4 review, NP-4). purgeDeletedHouseholds reported success while three kinds of
 * record survived it:
 *   - her private health, households/{hid}/mhealth/{uid}/cat/{category}. The app writes only the cat
 *     documents, never mhealth/{uid} itself, so the purge's plain listing of mhealth came back empty
 *     every time and it never found a single record to erase;
 *   - the pregnancy photo bytes, pregnancy/{uid}/photos/{photo}: the purge deleted pregnancy/{uid}
 *     and left its photos underneath, unreachable and still stored;
 *   - memberEmails/{uid}, each member's sign-in address, which was not on the list at all.
 * A stub cannot say what a real listing returns for a parent that was never written, so this one asks
 * Firestore. It also proves the order: a parent goes after its children, and the household document
 * goes last and only when everything under it is confirmed gone, so a failure part-way leaves the
 * flag in place for the next tick to finish the job.
 *
 *   cd test && npx firebase-tools emulators:exec --only firestore --project demo-cubby 'node purge-erase-emulator.test.js'
 */
const path = require('path');
const nodeCrypto = require('crypto');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 400) : '')); } };
const done = () => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PURGE-ERASE-EMU: FAIL' : 'PURGE-ERASE-EMU: PASS');
  process.exit(fail ? 1 : 0);
};

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
if (!EMU) { console.log('  FAIL FIRESTORE_EMULATOR_HOST is not set: this test needs the Firestore emulator'); fail++; done(); }
const ROOT = path.join(__dirname, '..');
const PROJECT = 'demo-cubby';
const DOCS = 'http://' + EMU + '/v1/projects/' + PROJECT + '/databases/(default)/documents';
const { privateKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SA = { project_id: PROJECT, client_email: 'cubby@demo-cubby.iam.gserviceaccount.com', private_key: privateKey };
const ADMIN = { authorization: 'Bearer owner' };

const realFetch = globalThis.fetch;
let failDelete = null;      // a path fragment: the first DELETE whose URL contains it answers 503
const deletes = [];         // every DELETE the purge made, in order, as a path under /documents/
globalThis.fetch = async (input, init) => {
  let url = String(input && input.url ? input.url : input);
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
  if (!url.startsWith('https://firestore.googleapis.com/v1/')) throw new Error('unexpected fetch ' + url);
  url = url.replace('https://firestore.googleapis.com/v1/', 'http://' + EMU + '/v1/').replace('/projects/little-log-a9caa/', '/projects/' + PROJECT + '/');
  const method = ((init && init.method) || 'GET').toUpperCase();
  if (method === 'DELETE') {
    const rel = url.split('/documents/')[1] || '';
    if (failDelete && rel.indexOf(failDelete) > -1) { failDelete = null; return new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: 503 }); }
    deletes.push(rel);
  }
  return realFetch(url, Object.assign({}, init, { headers: Object.assign({}, (init && init.headers) || {}, ADMIN) }));
};
const put = (p, fields) => realFetch(DOCS + '/' + p, { method: 'PATCH', headers: Object.assign({ 'content-type': 'application/json' }, ADMIN), body: JSON.stringify({ fields }) });
const exists = async (p) => (await realFetch(DOCS + '/' + p, { headers: ADMIN })).status === 200;
const subcollections = async (p) => {
  const r = await realFetch(DOCS + '/' + p + ':listCollectionIds', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, ADMIN), body: '{}' });
  return r.ok ? ((await r.json()).collectionIds || []) : ['<listCollectionIds ' + r.status + '>'];
};
const str = (x) => ({ stringValue: x });

/* One household's worth of records, in the shapes the app writes. mhealth/u2 and pregnancy/u4 are
   never written as documents themselves; only their children are, exactly as store-firebase.js does. */
const RECORDS = (hid) => [
  ['households/' + hid + '/events/e1', { type: str('feed'), authorId: str('u1') }],
  ['households/' + hid + '/photos/p1', { data: str('jpeg-bytes'), authorId: str('u1') }],
  ['households/' + hid + '/notes/n1', { text: str('a note'), authorId: str('u1') }],
  ['households/' + hid + '/memberEmails/u1', { email: str('u1@example.com') }],
  ['households/' + hid + '/memberEmails/u2', { email: str('u2@example.com') }],
  ['households/' + hid + '/mhealth/u2/cat/health', { bp: str('120/80') }],
  ['households/' + hid + '/mhealth/u2/cat/mood', { mood: str('low') }],
  ['households/' + hid + '/mhealth/u3', { kept: str('a parent that does exist') }],
  ['households/' + hid + '/mhealth/u3/cat/conditions', { list: str('gestational diabetes') }],
  ['households/' + hid + '/pregnancy/u2', { data: str('journey') }],
  ['households/' + hid + '/pregnancy/u2/photos/ph1', { data: str('bump-photo-bytes'), authorId: str('u2') }],
  ['households/' + hid + '/pregnancy/u4/photos/ph2', { data: str('scan-photo-bytes'), authorId: str('u4') }],
];

(async () => {
  await realFetch('http://' + EMU + '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  const mod = await import(pathToFileURL(path.join(ROOT, 'worker.js')).href);
  const purge = mod.__purge && mod.__purge.purgeDeletedHouseholds;
  ok('worker.js exports __purge.purgeDeletedHouseholds', typeof purge === 'function');
  if (typeof purge !== 'function') done();
  const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
  const logs = [];
  const origErr = console.error, origLog = console.log;
  const quiet = async (fn) => { console.error = (...a) => logs.push(a.join(' ')); console.log = (...a) => logs.push(a.join(' ')); try { return await fn(); } finally { console.error = origErr; console.log = origLog; } };

  // HP: the last member left and the grace window is over. HK: a family still using Cubby, unflagged.
  await put('households/HP', { deleteAfter: { integerValue: String(Date.now() - 1000) }, members: { mapValue: {} }, ownerId: str('u1') });
  await put('households/HK', { members: { mapValue: { fields: { k1: str('owner') } } }, ownerId: str('k1') });
  for (const hid of ['HP', 'HK']) for (const [p, f] of RECORDS(hid)) await put(p, f);

  console.log('\n1. every kind of record is really there before the purge (the reader can see them)');
  const before = await Promise.all(RECORDS('HP').map(([p]) => exists(p)));
  ok('all ' + before.length + ' seeded records exist', before.every(Boolean), RECORDS('HP').filter((_, i) => !before[i]).map(([p]) => p));
  ok('and mhealth/u2, the parent the app never writes, does not', !(await exists('households/HP/mhealth/u2')));
  ok('nor pregnancy/u4', !(await exists('households/HP/pregnancy/u4')));

  console.log('\n2. a delete fails part-way: nothing that leads back to what is left is removed');
  failDelete = 'pregnancy/u2/photos/ph1';
  const r1 = await quiet(() => purge(ENV));
  ok('the injected failure really happened', failDelete === null, failDelete);
  ok('the run purged no household', r1 && r1.households === 0, r1);
  ok('the household is still there, still flagged, for the next tick', await exists('households/HP'));
  ok('the pregnancy document is still there: a parent never goes before its children', await exists('households/HP/pregnancy/u2'));
  ok('its photo is still there to be found again', await exists('households/HP/pregnancy/u2/photos/ph1'));
  ok('and the run said it was incomplete', logs.some((l) => /purge_hh_incomplete/.test(l) && /HP/.test(l)), logs);

  console.log('\n3. the next tick finishes the job');
  deletes.length = 0;
  const r2 = await quiet(() => purge(ENV));
  ok('the run purged the household', r2 && r2.households === 1, r2);
  const after = await Promise.all(RECORDS('HP').map(([p]) => exists(p)));
  const left = RECORDS('HP').filter((_, i) => after[i]).map(([p]) => p);
  ok('not one record survives it', left.length === 0, left);
  for (const [p] of RECORDS('HP')) if (/mhealth|memberEmails|pregnancy\/u\d\/photos/.test(p)) ok(p.replace('households/HP/', '') + ' is gone', !(await exists(p)));
  ok('the household document is gone', !(await exists('households/HP')));
  ok('and nothing at all is left under it, at any depth', (await subcollections('households/HP')).length === 0, await subcollections('households/HP'));
  for (const sub of ['mhealth/u2', 'mhealth/u3', 'pregnancy/u2', 'pregnancy/u4']) {
    ok('nor under ' + sub, (await subcollections('households/HP/' + sub)).length === 0, await subcollections('households/HP/' + sub));
  }
  const hpDeletes = deletes.filter((d) => d.indexOf('households/HP') === 0);
  ok('the household document was the LAST thing deleted', hpDeletes[hpDeletes.length - 1] === 'households/HP', hpDeletes.slice(-3));
  const at = (p) => hpDeletes.indexOf(p);
  ok('each photo before its pregnancy document', at('households/HP/pregnancy/u2/photos/ph1') > -1 && at('households/HP/pregnancy/u2/photos/ph1') < at('households/HP/pregnancy/u2'), hpDeletes);
  ok('each health record before its mhealth document', at('households/HP/mhealth/u3/cat/conditions') > -1 && at('households/HP/mhealth/u3/cat/conditions') < at('households/HP/mhealth/u3'), hpDeletes);

  console.log('\n4. a family that is not flagged is untouched');
  const kept = await Promise.all(RECORDS('HK').map(([p]) => exists(p)));
  ok('every one of its records is still there', kept.every(Boolean), RECORDS('HK').filter((_, i) => !kept[i]).map(([p]) => p));
  ok('and the household itself', await exists('households/HK'));
  ok('the purge never even deleted under it', !deletes.some((d) => d.indexOf('households/HK') === 0), deletes.filter((d) => d.indexOf('households/HK') === 0));

  done();
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); fail++; done(); });
