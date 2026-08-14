/* Privacy audit probe: appBlobClean() blocks 'pregnancy'/'mhealth'/'maternalHealth' from the
   circle-shared blob because "the bare fact of expecting is the most sensitive event a family has"
   (firestore.rules:316-318). Does the bare fact of a pregnancy ENDING get the same protection?
   Run: cd test && npx firebase emulators:exec --only firestore --project demo-cubby "node loss-leak.test.js"

   Answer, as of 2026-08-14: NO. appBlobClean() screens pregnancy/mhealth/maternalHealth, and
   lossHolding is none of those, so it rides in the circle-shared blob. A nanny who was never told
   about the pregnancy can read app.lossHolding and learn both that the mother was pregnant and the
   minute it ended. The UI is careful never to broadcast the bereavement screen; the DATA is
   readable by every member of the circle.

   KEEP. This is a PROBE, not a gate: every "PASS" below means the hole is REAL and reproducible.
   Deliberately NOT wired into tools/gates.js, because a green gate here would mean the opposite of
   what green means everywhere else. Re-run it by hand after any rules change. */
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS ' + m); };
const no = (m) => { fail++; console.log('  FAIL ' + m); };

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-cubby',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();

  const HID = 'H1', MAMA = 'uid_mama', NANNY = 'uid_nanny';

  // Meera is expecting. She has deliberately shared her journey with NOBODY (sharedWith empty):
  // the nanny is in the circle to log nappies, and does not know she is pregnant.
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await db.doc('households/' + HID).set({
      ownerId: MAMA,
      members: { [MAMA]: 'owner', [NANNY]: 'caregiver' },
      memberInfo: { [MAMA]: { name: 'Meera' }, [NANNY]: { name: 'Ana', relationship: 'nanny' } },
      app: { babies: [], settings: {} },
    });
    await db.doc('households/' + HID + '/pregnancy/' + MAMA).set({ ownerUid: MAMA, sharedWith: [], data: { weeks: 11 } });
  });

  const nanny = env.authenticatedContext(NANNY, { email: 'ana@example.com' }).firestore();

  console.log('\n--- Baseline: the owner-owned journey doc IS protected ---');
  try {
    await assertFails(nanny.doc('households/' + HID + '/pregnancy/' + MAMA).get());
    ok('nanny cannot read households/H1/pregnancy/uid_mama (sharedWith is empty) — this is the design working');
  } catch (e) { no('nanny READ the private journey doc'); }

  console.log('\n--- Baseline: nobody can smuggle pregnancy back into the shared blob ---');
  try {
    await assertFails(nanny.doc('households/' + HID).update({ 'app.pregnancy': { weeks: 11 } }));
    ok('appBlobClean() blocks app.pregnancy');
  } catch (e) { no('app.pregnancy injection succeeded'); }

  // Now the loss. endPregnancy() (index.html:8007-8013) writes lossHolding into the SHARED blob.
  console.log('\n--- The loss: what endPregnancy() actually writes to the circle-shared blob ---');
  const mama = env.authenticatedContext(MAMA, { email: 'meera@example.com' }).firestore();
  const LOSS_AT = 1786600000000;
  try {
    await assertSucceeds(mama.doc('households/' + HID).update({ 'app.lossHolding': { [MAMA]: { at: LOSS_AT } } }));
    ok('lossHolding written to the shared blob (appBlobClean only screens pregnancy/mhealth/maternalHealth)');
  } catch (e) { no('unexpected: the write was blocked: ' + e.message.split('\n')[0]); }

  console.log('\n--- Can the nanny, who was never told about the pregnancy, read it? ---');
  try {
    const snap = await assertSucceeds(nanny.doc('households/' + HID).get());
    const lh = ((snap.data() || {}).app || {}).lossHolding || null;
    if (lh && lh[MAMA] && lh[MAMA].at === LOSS_AT) {
      ok('nanny READ app.lossHolding = ' + JSON.stringify(lh) + '  -> she learns Meera was pregnant AND the minute it ended');
    } else { no('lossHolding not visible in the nanny read'); }
  } catch (e) { no('nanny could not read the household at all: ' + e.message.split('\n')[0]); }

  console.log('\n--- Same shape: a scoped delete request names the pregnancy in the shared blob ---');
  try {
    await assertSucceeds(mama.doc('households/' + HID).update({
      'app.consents': [{ id: 'c1', type: 'delete', label: 'Delete: Pregnancy', requestedBy: MAMA, status: 'pending', approvals: [MAMA] }],
    }));
    const snap = await nanny.doc('households/' + HID).get();
    const label = (((snap.data() || {}).app || {}).consents || [{}])[0].label;
    ok('nanny reads consent label: "' + label + '"');
  } catch (e) { no('consent-label probe failed: ' + e.message.split('\n')[0]); }

  await env.cleanup();
  console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(0);
})();
