/* tools/invite_households.js against the Firestore emulator: which households have an email invite out,
 * for the founder's local reports (tools/ops.js, tools/analytics.js).
 *
 * Since one invite per family per address (November 2026) an invite lives in one of two places: the
 * address-keyed invites/{email}, and each family's own invites/{email}/from/{hid}, whose parent doc
 * usually does not exist, so a plain list of /invites never sees it. This proves both are counted,
 * and that the matcher which finds a family's own invite does not also count a 'from' collection
 * somewhere else, or one that names a different household than its own path.
 * The live funnel snapshot asks the same question over REST (worker.js funnelFamilyInvites): its exact
 * collection-group query is sent to the emulator too, because a stubbed fetch only proves the stub.
 *
 *   cd test && npx firebase-tools emulators:exec --only firestore --project demo-cubby "node invite-households.test.js"
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const adminFrom = (m) => require(require.resolve(m, { paths: [path.join(ROOT, 'tools')] }));

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 300) : '')); }
};

(async () => {
  console.log('\nwhich households have an email invite out (tools/invite_households.js)\n');
  if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log('  FAIL no FIRESTORE_EMULATOR_HOST: run inside emulators:exec'); process.exit(1); }
  const { initializeApp } = adminFrom('firebase-admin/app');
  const { getFirestore } = adminFrom('firebase-admin/firestore');
  const db = getFirestore(initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-cubby' }, 'invite-households'));

  let helper = null;
  try { helper = require(path.join(ROOT, 'tools', 'invite_households.js')); } catch (e) { helper = null; }
  ok('the helper exists', !!(helper && typeof helper.invitedHouseholdIds === 'function'));

  // Both reports use it, so neither counts the address-keyed invites alone.
  for (const f of ['ops.js', 'analytics.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'tools', f), 'utf8');
    ok('tools/' + f + ' takes its invited households from the helper',
      /require\('\.\/invite_households'\)/.test(src) && /invitedHouseholdIds\(db\)/.test(src) && !/invSnap\.docs\.map/.test(src));
  }

  const col = (p) => db.collection(p);
  await col('invites').doc('ann@x.test').set({ householdId: 'HH_LEGACY', role: 'caregiver' });
  await col('invites').doc('bo@x.test').collection('from').doc('HH_FAMILY').set({ householdId: 'HH_FAMILY', role: 'caregiver' });
  // The companions: the same matcher must SKIP these two.
  await col('households').doc('HH_ELSE').collection('from').doc('z').set({ householdId: 'HH_ELSE' });
  await col('invites').doc('cy@x.test').collection('from').doc('HH_PATH').set({ householdId: 'HH_OTHER' });

  const got = helper ? [...(await helper.invitedHouseholdIds(db))].sort() : [];
  ok('an address-keyed invite counts', got.includes('HH_LEGACY'), got);
  ok('a family\'s own invite, with no parent doc, counts', got.includes('HH_FAMILY'), got);
  ok('(companion) a collection called "from" under a household does not', !got.includes('HH_ELSE'), got);
  ok('(companion) a family invite naming another household than its path does not', !got.includes('HH_OTHER') && !got.includes('HH_PATH'), got);
  ok('exactly those two', JSON.stringify(got) === JSON.stringify(['HH_FAMILY', 'HH_LEGACY']), got);
  // The companion has to be able to fail: the same docs, with the path check removed, would count HH_ELSE.
  if (helper && helper.underInvites) {
    const snap = await db.collectionGroup('from').get();
    const loose = snap.docs.map((d) => (d.data() || {}).householdId);
    ok('(the matcher is load-bearing) without it, the stray "from" collection would have counted', loose.includes('HH_ELSE'), loose);
    ok('and with it, it does not', !snap.docs.filter(helper.underInvites).map((d) => d.data().householdId).includes('HH_ELSE'));
  }

  /* The live funnel snapshot (worker.js funnelFamilyInvites) asks the same question over REST, with a
     collection-group runQuery and a field mask. test/funnel-worker.test.js checks the body it sends to
     a stub; this sends that exact query to a real Firestore (the emulator) and reads what comes back. */
  console.log('\nthe Worker\'s funnel query, against the emulator');
  const { pathToFileURL } = require('url');
  const mod = await import(pathToFileURL(path.join(ROOT, 'worker.js')).href);
  const famQuery = mod.__funnelInvites && mod.__funnelInvites.funnelFamilyInvites;
  ok('worker.js exports funnelFamilyInvites, so it can be sent to a real Firestore', typeof famQuery === 'function');
  if (typeof famQuery === 'function') {
    const proj = process.env.GCLOUD_PROJECT || 'demo-cubby';
    const base = 'http://' + process.env.FIRESTORE_EMULATOR_HOST + '/v1/projects/' + proj + '/databases/(default)/documents';
    let spent = 0, docs = null, err = null;
    try { docs = await famQuery(base, 'owner', (n) => { spent += n; }); } catch (e) { err = String((e && e.message) || e); }
    ok('the query is accepted', !err && Array.isArray(docs), err);
    const names = (docs || []).map((d) => d.name || '');
    const hh = (docs || []).map((d) => (((d.fields || {}).householdId) || {}).stringValue);
    ok('it finds the family\'s own invite', hh.includes('HH_FAMILY'), names);
    ok('(companion) and not the "from" collection under a household', !hh.includes('HH_ELSE'), names);
    ok('every document it keeps sits under /invites', names.length > 0 && names.every((n) => /\/documents\/invites\/[^/]+\/from\/[^/]+$/.test(n)), names);
    ok('it reads householdId and nothing else', (docs || []).every((d) => Object.keys(d.fields || {}).join() === 'householdId'), (docs || []).map((d) => Object.keys(d.fields || {})));
    ok('and counts what it read', spent >= names.length && spent > 0, spent);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'INVITE-HOUSEHOLDS: FAIL' : 'INVITE-HOUSEHOLDS: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
