/* Privacy audit probe: does the "both guardians must agree" gate exist anywhere but the UI?
   Run: cd test && npx firebase emulators:exec --only firestore --project demo-cubby "node consent-blast.test.js"
   KEEP. This is a PROBE, not a gate: every "PASS" below means the hole is REAL and reproducible.
   Deliberately NOT wired into tools/gates.js, because a green gate here would mean the opposite of
   what green means everywhere else. Re-run it by hand after any rules change. */
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS ' + m); };
const no = (m) => { fail++; console.log('  FAIL ' + m); };

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-cubby',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();

  const HID = 'H1';
  const OWNER = 'uid_mama', CARE = 'uid_nanny';

  // Seed a household: mama is owner, the nanny is a caregiver. A real baby record in the blob.
  await env.withSecurityRulesDisabled(async (c) => {
    await c.firestore().doc('households/' + HID).set({
      ownerId: OWNER,
      members: { [OWNER]: 'owner', [CARE]: 'caregiver' },
      memberInfo: { [OWNER]: { name: 'Meera', relationship: 'mother' }, [CARE]: { name: 'Ana', relationship: 'nanny' } },
      app: {
        babies: [{ id: 'b1', name: 'Ira', dob: '2026-06-01' }],
        meds: [{ id: 'm1', name: 'Amoxicillin' }],
        vaccines: { b1: { bcg: true } },
        illnesses: [{ id: 'i1', what: 'fever' }],
        milestones: [{ id: 's1', what: 'first smile' }],
        photos: [{ photoId: 'p1' }],
        consents: [],
        guardians: null,
      },
    });
  });

  const care = env.authenticatedContext(CARE, { email: 'nanny@example.com' }).firestore();

  console.log('\n--- Q1: can a caregiver erase the household record with nobody agreeing? ---');
  // Exactly what executeScopedDelete({babies:true,photos:true}) then persist() writes.
  const wiped = {
    babies: [], meds: [], vaccines: {}, illnesses: [], milestones: [], photos: [],
    consents: [], guardians: null,
  };
  try {
    await assertSucceeds(care.doc('households/' + HID).update({ app: wiped }));
    ok('caregiver ALONE wiped babies+meds+vaccines+illnesses+milestones+photos from the shared blob');
  } catch (e) { no('the rules blocked the unilateral wipe: ' + e.message.split('\n')[0]); }

  console.log('\n--- Q2: can a caregiver forge a completed dual-guardian approval? ---');
  try {
    await assertSucceeds(care.doc('households/' + HID).update({
      'app.consents': [{ id: 'c1', type: 'delete', requestedBy: CARE, approvals: [OWNER, CARE], status: 'done', label: 'Delete: everything' }],
    }));
    ok('caregiver wrote a consent record showing the OWNER approved a deletion she never saw');
  } catch (e) { no('rules blocked the forged approval: ' + e.message.split('\n')[0]); }

  console.log('\n--- Q3: can a caregiver make herself a guardian? (householdGuardians() matches relationship text) ---');
  try {
    await assertSucceeds(care.doc('households/' + HID).update({
      ['memberInfo.' + CARE]: { name: 'Ana', relationship: 'mother' },
    }));
    ok('caregiver relabelled her own relationship to "mother" -> counted as a guardian by index.html:5634');
  } catch (e) { no('rules blocked the relabel: ' + e.message.split('\n')[0]); }

  console.log('\n--- Control: the rules DO still hold the lines they claim to ---');
  try {
    await assertFails(care.doc('households/' + HID).update({ ['members.' + CARE]: 'owner' }));
    ok('control: caregiver still cannot promote herself to owner');
  } catch (e) { no('CONTROL BROKE: self-promotion succeeded'); }
  try {
    await assertFails(care.doc('households/' + HID).update({ 'app.pregnancy': { weeks: 12 } }));
    ok('control: caregiver still cannot inject pregnancy into the shared blob');
  } catch (e) { no('CONTROL BROKE: pregnancy injection succeeded'); }

  await env.cleanup();
  console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(0);
})();
