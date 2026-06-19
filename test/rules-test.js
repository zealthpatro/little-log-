'use strict';
// Cross-account emulator test for firestore.rules. Run via `npm run test:rules` (see README.md).
// Verifies the tightened household update rule: the memberInfo lock + the app-blob maternal-data
// guard block tampering, without breaking a normal app save or a legacy-blob household.
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc } = require('firebase/firestore');

const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

// Mirrors appBlobFromState() in app/store-firebase.js — the only keys a real client ever writes.
function cleanApp(extra) {
  return Object.assign({
    babies: [], settings: {}, milestones: [], meds: [], vaccines: {}, illnesses: [],
    photos: [], handoff: null, den: null, consents: [], guardians: null, timers: {}
  }, extra || {});
}

const results = { pass: 0, fail: 0 };
async function check(name, p) {
  try { await p; results.pass++; console.log('  ✓ ' + name); }
  catch (e) { results.fail++; console.log('  ✗ ' + name + '   (' + ((e && e.message) || e) + ')'); }
}

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-cubby', firestore: { rules: RULES } });
  await env.clearFirestore();

  // Seed (rules disabled): H = clean blob; HL = a household whose stored blob still holds a legacy
  // pregnancy key (pre Item 7), to prove that does not block unrelated edits.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'households/H'), {
      ownerId: 'O', members: { O: 'owner', C: 'caregiver' },
      memberInfo: {
        O: { name: 'Mom', relationship: 'Mama Bear', email: 'o@x.com' },
        C: { name: 'Dad', relationship: 'Papa Bear', email: 'c@x.com' }
      },
      app: cleanApp()
    });
    await setDoc(doc(db, 'households/HL'), {
      ownerId: 'O', members: { O: 'owner', C: 'caregiver' },
      memberInfo: { O: { name: 'Mom' }, C: { name: 'Dad' } },
      app: cleanApp({ pregnancy: { weeks: 20 } })
    });
    await setDoc(doc(db, 'invites/inv@x.com'), { householdId: 'H' }); // pending invite for the join test
  });

  const C = env.authenticatedContext('C', { email: 'c@x.com' }).firestore(); // caregiver
  const O = env.authenticatedContext('O', { email: 'o@x.com' }).firestore(); // owner
  const S = env.authenticatedContext('S', { email: 's@x.com' }).firestore(); // stranger
  const INV = env.authenticatedContext('INV', { email: 'inv@x.com' }).firestore(); // invited, not yet a member

  console.log('\nLegit writes (must SUCCEED):');
  await check('caregiver writes app blob (normal persist)', assertSucceeds(updateDoc(doc(C, 'households/H'), { app: cleanApp() })));
  await check('caregiver edits OWN memberInfo', assertSucceeds(updateDoc(doc(C, 'households/H'), { 'memberInfo.C.relationship': 'Driver' })));
  await check('owner writes app blob', assertSucceeds(updateDoc(doc(O, 'households/H'), { app: cleanApp() })));
  await check('owner edits another member memberInfo (remove/rename flow)', assertSucceeds(updateDoc(doc(O, 'households/H'), { 'memberInfo.C.relationship': 'Caregiver' })));
  await check('caregiver edits OWN memberInfo on a LEGACY-pregnancy-blob household', assertSucceeds(updateDoc(doc(C, 'households/HL'), { 'memberInfo.C.relationship': 'Cook' })));
  await check('caregiver writes a CLEAN app on the legacy household (drops pregnancy)', assertSucceeds(updateDoc(doc(C, 'households/HL'), { app: cleanApp() })));

  console.log('\nAttacks (must FAIL):');
  await check('caregiver edits ANOTHER member memberInfo', assertFails(updateDoc(doc(C, 'households/H'), { 'memberInfo.O.name': 'hacked' })));
  await check('caregiver injects pregnancy into the app blob', assertFails(updateDoc(doc(C, 'households/H'), { app: cleanApp({ pregnancy: { weeks: 20 } }) })));
  await check('caregiver injects mhealth into the app blob', assertFails(updateDoc(doc(C, 'households/H'), { app: cleanApp({ mhealth: { mood: 'low' } }) })));
  await check('owner injects pregnancy into the app blob (blocked for everyone)', assertFails(updateDoc(doc(O, 'households/H'), { app: cleanApp({ pregnancy: { weeks: 20 } }) })));
  await check('caregiver promotes self to owner (members change)', assertFails(updateDoc(doc(C, 'households/H'), { members: { O: 'owner', C: 'owner' } })));
  await check('caregiver changes ownerId', assertFails(updateDoc(doc(C, 'households/H'), { ownerId: 'C' })));
  await check('caregiver sets pro entitlement', assertFails(updateDoc(doc(C, 'households/H'), { pro: { plan: 'lifetime' } })));
  await check('stranger reads the household', assertFails(getDoc(doc(S, 'households/H'))));
  await check('stranger writes the household', assertFails(updateDoc(doc(S, 'households/H'), { app: cleanApp() })));
  await check('invitee adds ANOTHER member (privilege grab)', assertFails(updateDoc(doc(INV, 'households/H'), { 'members.X': 'owner' })));
  await check('invitee edits another member memberInfo', assertFails(updateDoc(doc(INV, 'households/H'), { 'memberInfo.O.name': 'hacked' })));

  console.log('\nInvitee join (must SUCCEED — adds only themselves):');
  await check('invitee joins by adding only themselves', assertSucceeds(updateDoc(doc(INV, 'households/H'), { 'members.INV': 'caregiver', 'memberInfo.INV': { name: 'Invitee', email: 'inv@x.com', role: 'caregiver', relationship: 'Auntie Bear' } })));

  await env.cleanup();
  console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
  process.exit(results.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
