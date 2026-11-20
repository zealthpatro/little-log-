/* Cubby Ops (tools/ops.js) serves its dashboard's data from a real Firestore on firebase-admin 14.
 *
 * Until 16 November 2026 ops.js used the namespace API (admin.credential.cert, admin.firestore()),
 * which firebase-admin 14 no longer has, so every /api/data answered 500 "reading 'cert'" and the
 * dashboard drew nothing. A stub would not have seen it: the crash was in how the client was built.
 * So this builds ops.js's client on its own cert(sa) line with a throwaway in-memory key, serves its own
 * HTTP handler on a free port against the Firestore emulator, seeds two families, and reads /api/data
 * back the way the page does.
 * tools/admin_sdk_check.js keeps the old API out of every other script.
 *
 *   node tools/gates.js --emulator --only=ops-admin
 *   cd test && npx firebase-tools emulators:exec --only firestore --project demo-cubby "node ops-admin.test.js"
 */
'use strict';
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const adminFrom = (m) => require(require.resolve(m, { paths: [path.join(ROOT, 'tools')] }));

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : '')); }
};
const get = (port, p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port, path: p }, (r) => {
    let body = ''; r.on('data', (c) => { body += c; }); r.on('end', () => res({ status: r.statusCode, body }));
  }).on('error', rej);
});

(async () => {
  console.log('\nCubby Ops reads a real Firestore on firebase-admin 14 (tools/ops.js)\n');
  if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log('  FAIL no FIRESTORE_EMULATOR_HOST: run inside emulators:exec'); process.exit(1); }
  const PROJECT = process.env.GCLOUD_PROJECT || 'demo-cubby';
  const { initializeApp } = adminFrom('firebase-admin/app');
  const { getFirestore, Timestamp } = adminFrom('firebase-admin/firestore');
  const db = getFirestore(initializeApp({ projectId: PROJECT }, 'ops-admin-seed'));

  const now = Date.now(), HOUR = 3600000, DAY = 24 * HOUR;
  const ts = (t) => Timestamp.fromMillis(t);
  await db.collection('users').doc('u_ann').set({ acq: { source: 'instagram', content: 'keepsake' } });
  await db.collection('users').doc('u_bo').set({});
  await db.collection('households').doc('HH_TWO').set({
    ownerId: 'u_ann', createdAt: ts(now - 30 * DAY),
    members: { u_ann: 'owner', u_bo: 'caregiver' },
    memberInfo: { u_ann: { name: 'Ann', email: 'ann@x.test', relationship: 'Mama Bear' }, u_bo: { name: 'Bo', email: 'bo@x.test' } },
    app: { babies: [{ name: 'Zed', birth: now - 90 * DAY, country: 'AE' }] },
  });
  await db.collection('households').doc('HH_SOLO').set({
    ownerId: 'u_cy', createdAt: ts(now - 10 * DAY), members: { u_cy: 'owner' },
    memberInfo: { u_cy: { name: 'Cy', email: 'cy@x.test' } },
  });
  const ev = db.collection('households').doc('HH_TWO').collection('events');
  await ev.doc('e1').set({ type: 'feed', time: now - HOUR, authorId: 'u_ann' });
  await ev.doc('e2').set({ type: 'sleep', time: ts(now - 2 * DAY), authorId: 'u_bo', photoId: 'p1' });
  await db.collection('feedback').doc('f1').set({ text: 'Two of us  log now', createdAt: ts(now - DAY) });
  await db.collection('waitlist').doc('u_ann').set({ at: ts(now) });
  await db.collection('invites').doc('dee@x.test').set({ householdId: 'HH_SOLO', role: 'caregiver' });

  let ops = null, loadErr = null;
  try { ops = require(path.join(ROOT, 'tools', 'ops.js')); } catch (e) { loadErr = String(e && e.message || e); }
  ok('tools/ops.js loads without starting its own server, and hands its server and initDb over',
    !!(ops && ops.server && typeof ops.server.listen === 'function' && typeof ops.initDb === 'function'), loadErr);
  if (!ops || !ops.server || typeof ops.initDb !== 'function') { console.log('\nOPS-ADMIN: FAIL'); process.exit(1); }

  /* The client is built on the founder's own line, cert(sa), with a service-account key made here in
     memory and thrown away: no key file is written, and against the emulator nothing real is reached.
     A test-only branch in ops.js would leave that line untested (16 Nov review: a break in it passed). */
  const { privateKey } = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 });
  const throwaway = {
    type: 'service_account', project_id: PROJECT, private_key_id: 'ops-admin-test',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    client_email: 'ops-admin-test@' + PROJECT + '.iam.gserviceaccount.com',
  };
  /* emulators:exec exports the project id, and the emulator never checks a credential, so a client
     built with NO key would pass everything below (second review, 20 Nov). Take the project id away
     first: then the only place the client can learn it is the key it was handed, as on the founder's
     machine, and dropping the credential fails here. */
  delete process.env.GCLOUD_PROJECT; delete process.env.GOOGLE_CLOUD_PROJECT; delete process.env.GCP_PROJECT;
  let initErr = null;
  try { ops.initDb(throwaway); } catch (e) { initErr = String(e && e.message || e); }
  ok('initDb builds its client from a service-account key, the way the founder runs it', !initErr, initErr);

  /* The founder's run reads the key from tools/serviceAccountKey.json, the path .gitignore fences and
     tools/deploy_exclusion_check.js walks for. This test hands the key in, so that one line is held
     to its exact path here instead (second review: a typo in it passed every gate). */
  const opsSrc = require('fs').readFileSync(path.join(ROOT, 'tools', 'ops.js'), 'utf8');
  const ignore = require('fs').readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  ok("with no key handed in, ops.js reads tools/serviceAccountKey.json, the path .gitignore fences",
    /sa = require\(path\.join\(__dirname, 'serviceAccountKey\.json'\)\)/.test(opsSrc) && ignore.includes('tools/serviceAccountKey.json'));

  await new Promise((res) => ops.server.listen(0, '127.0.0.1', res));
  const port = ops.server.address().port;
  let r = null, d = null;
  try { r = await get(port, '/api/data'); d = JSON.parse(r.body); } catch (e) { d = { error: String(e && e.message || e) }; }
  ok('/api/data answers 200, not the 500 firebase-admin 14 gave the old client', r && r.status === 200, r && r.body.slice(0, 200));
  ok('and carries no error', d && !d.error, d && d.error);
  const h = (d && d.headline) || {};
  ok('it is live data, read through the client, not the demo', d && d.mode === 'live', d && d.mode);
  ok('every collection was read: users, households, events, waitlist, feedback',
    h.users === 2 && h.households === 2 && h.totalEvents === 2 && h.proWaitlist === 1 && h.feedback === 1, h);
  ok('the headline is computed from it: one family with two people, one active today', h.multiCaregiver === 1 && h.active24h === 1, h);
  const two = ((d && d.households) || []).find((x) => x.id === 'HH_TWO') || {};
  ok('the most recent family comes first', d && d.households && d.households[0] && d.households[0].id === 'HH_TWO');
  ok('its people, baby, events and photo come through', two.memberCount === 2
    && (two.members || []).map((m) => m.name + ':' + m.role).sort().join(',') === 'Ann:owner,Bo:caregiver'
    && (two.babies || [])[0] && two.babies[0].name === 'Zed' && two.events === 2 && two.photos === 1, two);
  ok('a Timestamp and a plain number both read as times', two.activeDays === 2 && two.last > now - 2 * HOUR, two);
  ok('acquisition is joined from users/{owner}', two.acq && two.acq.content === 'keepsake', two.acq);
  const types = ((d && d.eventTypes) || []).map((t) => t.type + ':' + t.n).sort().join(',');
  ok('what is being logged is counted by type', types === 'feed:1,sleep:1', types);
  ok('the funnel is drawn', Array.isArray(d && d.funnel) && d.funnel.length > 0 && d.funnel[0].count === 2, d && d.funnel);
  ok('feedback reads back with its date', (d.feedback || [])[0] && d.feedback[0].text === 'Two of us log now' && /^\d{4}-\d{2}-\d{2}$/.test(d.feedback[0].when), d.feedback);
  const page = await get(port, '/');
  ok('the page itself is served, and asks /api/data', page.status === 200 && page.body.includes("fetch('/api/data')"));

  ops.server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('OPS-ADMIN: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL ' + (e && e.stack || e)); process.exit(1); });
