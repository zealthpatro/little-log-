'use strict';
// Cross-account emulator test for firestore.rules. Run via `npm run test:rules` (see README.md).
// Verifies the tightened household update rule: the memberInfo lock + the app-blob maternal-data
// guard block tampering, without breaking a normal app save or a legacy-blob household.
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc, deleteDoc } = require('firebase/firestore');

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
    await setDoc(doc(db, 'invites/att@x.com'), { householdId: 'HA' }); // attacker's own-household invite (redirect test)
    await setDoc(doc(db, 'households/HA'), { ownerId: 'ATT', members: { ATT: 'owner' }, memberInfo: { ATT: { name: 'Attacker' } }, app: cleanApp() });
    // Subcollection docs for the authorship / immutability tests.
    await setDoc(doc(db, 'households/H/events/e-own'), { type: 'feed', time: 1, authorId: 'C' });
    await setDoc(doc(db, 'households/H/events/e-mom'), { type: 'feed', time: 2, authorId: 'O' });
    await setDoc(doc(db, 'households/H/photos/p-own'), { data: 'x', authorId: 'C' });
    await setDoc(doc(db, 'households/H/photos/p-mom'), { data: 'x', authorId: 'O' });
    await setDoc(doc(db, 'households/H/notes/n-priv'), { text: 'secret', audience: 'O', createdBy: 'C', pinned: false });
    await setDoc(doc(db, 'invites/co@x.com'), { householdId: 'H', role: 'owner' }); // a legit owner-set co-owner invite (SEC-3 positive)
    await setDoc(doc(db, 'households/H/events/e-legacy'), { type: 'feed', time: 5 }); // pre-authorId legacy event (SEC-4 tolerance)
    await setDoc(doc(db, 'households/H/photos/p-keep'), { data: 'x', authorId: 'C' });  // for the keep-authorId update test
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
  // PRIV-4: an invited-but-not-joined user must NOT read the full household doc (blob + emails).
  await check('member reads the household (PRIV-4 baseline, succeeds)', assertSucceeds(getDoc(doc(C, 'households/H'))));
  await check('invitee reads the FULL household doc pre-join (PRIV-4, fails)', assertFails(getDoc(doc(INV, 'households/H'))));
  // SEC-3: an invitee may only join with the role the OWNER set on the invite — no self-promotion.
  await check('invitee joins as OWNER — self-promote (SEC-3, fails)', assertFails(updateDoc(doc(INV, 'households/H'), { 'members.INV': 'owner', 'memberInfo.INV': { name: 'Invitee', role: 'owner' } })));

  const ATT = env.authenticatedContext('ATT', { email: 'att@x.com' }).firestore(); // owner of HA, attacker

  console.log('\nInvite redirect / hijack (must FAIL):');
  await check('attacker re-points OWN invite at victim household', assertFails(updateDoc(doc(ATT, 'invites/att@x.com'), { householdId: 'H' })));
  await check('attacker (an owner elsewhere) hijacks ANOTHER invite to their household', assertFails(updateDoc(doc(ATT, 'invites/inv@x.com'), { householdId: 'HA' })));
  await check('invitee updates their own invite doc', assertFails(updateDoc(doc(INV, 'invites/inv@x.com'), { householdId: 'HA' })));

  console.log('\nInvite owner maintenance (must SUCCEED):');
  await check('owner re-saves an invite for the SAME household', assertSucceeds(updateDoc(doc(O, 'invites/inv@x.com'), { householdId: 'H', role: 'caregiver' })));

  console.log('\nEvents authorship:');
  await check('caregiver creates event as SELF (succeeds)', assertSucceeds(setDoc(doc(C, 'households/H/events/e-new'), { type: 'feed', time: 3, authorId: 'C' })));
  await check('caregiver creates event forged as OWNER (fails)', assertFails(setDoc(doc(C, 'households/H/events/e-forged'), { type: 'feed', time: 4, authorId: 'O' })));
  await check('caregiver edits OWN event (succeeds)', assertSucceeds(setDoc(doc(C, 'households/H/events/e-own'), { type: 'feed', time: 9, authorId: 'C' })));
  await check('caregiver edits OWNER event (fails)', assertFails(setDoc(doc(C, 'households/H/events/e-mom'), { type: 'feed', time: 9, authorId: 'O' })));
  await check('owner edits caregiver event (succeeds)', assertSucceeds(setDoc(doc(O, 'households/H/events/e-own'), { type: 'feed', time: 10, authorId: 'C' })));
  // SEC-4: authorId is immutable on update — neither the author nor the owner may re-attribute.
  await check('caregiver re-attributes OWN event (SEC-4, fails)', assertFails(setDoc(doc(C, 'households/H/events/e-own'), { type: 'feed', time: 11, authorId: 'O' })));
  await check('owner re-attributes an event (SEC-4, fails)', assertFails(setDoc(doc(O, 'households/H/events/e-own'), { type: 'feed', time: 12, authorId: 'O' })));
  await check('owner backfills authorId on a LEGACY event (tolerant, succeeds)', assertSucceeds(setDoc(doc(O, 'households/H/events/e-legacy'), { type: 'feed', time: 13, authorId: 'O' })));

  console.log('\nPhotos authorship:');
  await check('caregiver adds photo as SELF (succeeds)', assertSucceeds(setDoc(doc(C, 'households/H/photos/p-new'), { data: 'x', authorId: 'C' })));
  await check('caregiver adds photo forged as OWNER (fails)', assertFails(setDoc(doc(C, 'households/H/photos/p-forged'), { data: 'x', authorId: 'O' })));
  await check('caregiver deletes OWN photo (succeeds)', assertSucceeds(deleteDoc(doc(C, 'households/H/photos/p-own'))));
  await check('caregiver deletes OWNER photo (fails)', assertFails(deleteDoc(doc(C, 'households/H/photos/p-mom'))));
  await check('caregiver overwrites OWNER photo (fails)', assertFails(setDoc(doc(C, 'households/H/photos/p-mom'), { data: 'evil', authorId: 'C' })));
  await check('owner deletes caregiver photo (succeeds)', assertSucceeds(deleteDoc(doc(O, 'households/H/photos/p-new'))));
  await check('caregiver overwrites OWN photo keeping authorId (succeeds)', assertSucceeds(setDoc(doc(C, 'households/H/photos/p-keep'), { data: 'y', authorId: 'C' })));
  await check('owner re-attributes a photo (SEC-4, fails)', assertFails(setDoc(doc(O, 'households/H/photos/p-keep'), { data: 'z', authorId: 'O' })));

  console.log('\nNotes immutability:');
  await check('author pins own note (succeeds)', assertSucceeds(updateDoc(doc(C, 'households/H/notes/n-priv'), { pinned: true })));
  await check('author flips private note to circle (fails)', assertFails(updateDoc(doc(C, 'households/H/notes/n-priv'), { audience: 'circle' })));
  await check('author re-attributes note (fails)', assertFails(updateDoc(doc(C, 'households/H/notes/n-priv'), { createdBy: 'O' })));

  console.log('\nInvitee join (must SUCCEED — adds only themselves):');
  await check('invitee joins by adding only themselves', assertSucceeds(updateDoc(doc(INV, 'households/H'), { 'members.INV': 'caregiver', 'memberInfo.INV': { name: 'Invitee', email: 'inv@x.com', role: 'caregiver', relationship: 'Auntie Bear' } })));
  // SEC-3 positive: a co-owner invite (owner set role='owner') must still let the invitee join as owner.
  const CO = env.authenticatedContext('CO', { email: 'co@x.com' }).firestore();
  await check('co-owner invitee joins as OWNER (invite role=owner, succeeds)', assertSucceeds(updateDoc(doc(CO, 'households/H'), { 'members.CO': 'owner', 'memberInfo.CO': { name: 'CoOwner', email: 'co@x.com', role: 'owner', relationship: 'Papa Bear' } })));

  await env.cleanup();
  console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
  process.exit(results.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
