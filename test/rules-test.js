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

  // ==========================================================================
  // PART 2 — the marketed privacy promises + entitlement + lifecycle.
  // Added 2026-07-12 (design/RULES-REVIEW.md): the suite previously never tested
  // mhealth (mood NEVER shareable), the pregnancy journey, pro, create/delete,
  // or the top-level collections. These are the claims on the marketing site.
  // ==========================================================================
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'households/H/mhealth/O/cat/health'),     { ownerUid: 'O', sharedWith: ['C'], entries: [] });
    await setDoc(doc(db, 'households/H/mhealth/O/cat/conditions'), { ownerUid: 'O', sharedWith: [], entries: [] });
    await setDoc(doc(db, 'households/H/mhealth/O/cat/mood'),       { ownerUid: 'O', entries: [{ epds: 4 }] });
    await setDoc(doc(db, 'households/H/pregnancy/O'), { ownerUid: 'O', stage: 'expecting', edd: 20270101, sharedWith: [] });
    await setDoc(doc(db, 'households/H/notes/n-mom-priv'), { text: 'owner private', audience: 'O', createdBy: 'O' });
    await setDoc(doc(db, 'households/H/notes/n-circle'),   { text: 'handoff', audience: 'circle', createdBy: 'O' });
    await setDoc(doc(db, 'households/HP'), { ownerId: 'O', members: { O: 'owner' }, memberInfo: { O: { name: 'Mom' } }, app: cleanApp(), pro: { active: true, plan: 'annual', status: 'active' } });
  });

  console.log('\nMaternal health — mood NEVER shareable (the core promise):');
  await check('owner reads her own health category', assertSucceeds(getDoc(doc(O, 'households/H/mhealth/O/cat/health'))));
  await check('member on sharedWith reads that category', assertSucceeds(getDoc(doc(C, 'households/H/mhealth/O/cat/health'))));
  await check('member NOT on sharedWith reads a category (fails)', assertFails(getDoc(doc(C, 'households/H/mhealth/O/cat/conditions'))));
  await check('MOOD: any other member reads it (fails, always)', assertFails(getDoc(doc(C, 'households/H/mhealth/O/cat/mood'))));
  await check('MOOD: owner writes mood WITH a sharedWith list (fails)', assertFails(setDoc(doc(O, 'households/H/mhealth/O/cat/mood'), { ownerUid: 'O', sharedWith: ['C'], entries: [] })));
  await check('MOOD: owner writes mood with no sharedWith (succeeds)', assertSucceeds(setDoc(doc(O, 'households/H/mhealth/O/cat/mood'), { ownerUid: 'O', entries: [{ epds: 5 }] })));
  await check('another member writes her health data (fails)', assertFails(setDoc(doc(C, 'households/H/mhealth/O/cat/health'), { ownerUid: 'O', sharedWith: ['C'], entries: ['tampered'] })));
  await check('owner mislabels ownerUid on her own doc (fails)', assertFails(setDoc(doc(O, 'households/H/mhealth/O/cat/health'), { ownerUid: 'C', sharedWith: [], entries: [] })));
  await check('stranger reads mhealth (fails)', assertFails(getDoc(doc(S, 'households/H/mhealth/O/cat/health'))));
  // Hostile seed: even if a mood doc somehow CONTAINS a sharedWith list, reads must still deny.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'households/H/mhealth/O/cat/mood'), { ownerUid: 'O', sharedWith: ['C'], entries: [] });
  });
  await check('MOOD: hostile sharedWith present — member read still fails', assertFails(getDoc(doc(C, 'households/H/mhealth/O/cat/mood'))));

  console.log('\nPregnancy journey — owner-owned, consent-shared:');
  await check('owner reads her journey', assertSucceeds(getDoc(doc(O, 'households/H/pregnancy/O'))));
  await check('unshared member cannot even see the pregnancy exists (fails)', assertFails(getDoc(doc(C, 'households/H/pregnancy/O'))));
  await check('owner shares journey (writes sharedWith)', assertSucceeds(setDoc(doc(O, 'households/H/pregnancy/O'), { ownerUid: 'O', stage: 'expecting', edd: 20270101, sharedWith: ['C'] })));
  await check('shared member CAN read after consent', assertSucceeds(getDoc(doc(C, 'households/H/pregnancy/O'))));
  await check('shared member still cannot WRITE the journey (fails)', assertFails(setDoc(doc(C, 'households/H/pregnancy/O'), { ownerUid: 'O', stage: 'expecting', sharedWith: ['C'], tampered: true })));
  await check('stranger reads the journey (fails)', assertFails(getDoc(doc(S, 'households/H/pregnancy/O'))));

  console.log('\nNotes read scope:');
  await check('member reads a circle note', assertSucceeds(getDoc(doc(C, 'households/H/notes/n-circle'))));
  await check('non-audience member reads a private note (fails)', assertFails(getDoc(doc(C, 'households/H/notes/n-mom-priv'))));
  await check('stranger reads a circle note (fails)', assertFails(getDoc(doc(S, 'households/H/notes/n-circle'))));
  await check('member creates a note forged as someone else (fails)', assertFails(setDoc(doc(C, 'households/H/notes/n-forge'), { text: 'x', audience: 'circle', createdBy: 'O' })));

  console.log('\nPro entitlement — server-only:');
  await check('owner grants themselves Pro (fails)', assertFails(updateDoc(doc(O, 'households/H'), { pro: { active: true, plan: 'annual' } })));
  await check('owner extends an EXISTING Pro entitlement (fails)', assertFails(updateDoc(doc(O, 'households/HP'), { pro: { active: true, plan: 'annual', status: 'active', until: 9999999999999 } })));
  await check('owner saves blob on a Pro household, pro untouched (succeeds)', assertSucceeds(updateDoc(doc(O, 'households/HP'), { app: cleanApp() })));
  await check('household created WITH pro pre-set (fails)', assertFails(setDoc(doc(S, 'households/HS-pro'), { ownerId: 'S', members: { S: 'owner' }, memberInfo: {}, app: cleanApp(), pro: { active: true } })));

  console.log('\nHousehold lifecycle:');
  await check('user creates their own new household (succeeds)', assertSucceeds(setDoc(doc(S, 'households/HS'), { ownerId: 'S', members: { S: 'owner' }, memberInfo: { S: { name: 'Solo' } }, app: cleanApp() })));
  await check('user creates a household claiming another ownerId (fails)', assertFails(setDoc(doc(S, 'households/HS2'), { ownerId: 'O', members: { S: 'owner' }, memberInfo: {}, app: cleanApp() })));
  await check('create household with maternal data in the app blob (fails)', assertFails(setDoc(doc(S, 'households/HS3'), { ownerId: 'S', members: { S: 'owner' }, memberInfo: {}, app: cleanApp({ pregnancy: { weeks: 10 } }) })));
  await check('caregiver deletes the household (fails)', assertFails(deleteDoc(doc(C, 'households/H'))));
  await check('uninvited user writes self into members (fails)', assertFails(updateDoc(doc(S, 'households/H'), { 'members.S': 'caregiver' })));
  await check('stranger reads events subcollection (fails)', assertFails(getDoc(doc(S, 'households/H/events/e-mom'))));

  console.log('\nInvite create (owner-only + role hygiene):');
  await check('owner creates an invite, role caregiver (succeeds)', assertSucceeds(setDoc(doc(O, 'invites/newc@x.com'), { householdId: 'H', role: 'caregiver' })));
  await check('owner creates a co-owner invite, role owner (succeeds)', assertSucceeds(setDoc(doc(O, 'invites/newo@x.com'), { householdId: 'H', role: 'owner' })));
  await check('owner creates an invite with a BOGUS role (fails)', assertFails(setDoc(doc(O, 'invites/newx@x.com'), { householdId: 'H', role: 'superadmin' })));
  await check('caregiver creates an invite (fails, owner-only)', assertFails(setDoc(doc(C, 'invites/newy@x.com'), { householdId: 'H', role: 'caregiver' })));

  console.log('\nTop-level collections:');
  await check('users: own doc write (succeeds)', assertSucceeds(setDoc(doc(O, 'users/O'), { householdId: 'H' })));
  await check('users: another user\'s doc read (fails)', assertFails(getDoc(doc(C, 'users/O'))));
  await check('newsletter: signed-in read (fails)', assertFails(getDoc(doc(O, 'newsletter/x'))));
  await check('newsletter: signed-in write (fails)', assertFails(setDoc(doc(O, 'newsletter/x'), { email: 'a@b.c' })));
  await check('waitlist: own signup (succeeds)', assertSucceeds(setDoc(doc(C, 'waitlist/C'), { email: 'c@x.com' })));
  await check('waitlist: someone else\'s signup read (fails)', assertFails(getDoc(doc(C, 'waitlist/O'))));
  await check('feedback: create (succeeds)', assertSucceeds(setDoc(doc(C, 'feedback/f1'), { text: 'love it' })));
  await check('feedback: read back (fails)', assertFails(getDoc(doc(C, 'feedback/f1'))));

  console.log('\nInvite create — owner-only + role hygiene (2026-07-12 hardening):');
  await check('owner creates a caregiver invite (succeeds)', assertSucceeds(setDoc(doc(O, 'invites/new-cg@x.com'), { householdId: 'H', role: 'caregiver' })));
  await check('owner creates a co-owner invite (succeeds)', assertSucceeds(setDoc(doc(O, 'invites/new-co@x.com'), { householdId: 'H', role: 'owner' })));
  await check('owner creates an invite with NO role — defaults caregiver (succeeds)', assertSucceeds(setDoc(doc(O, 'invites/new-def@x.com'), { householdId: 'H' })));
  await check('owner creates an invite with a BOGUS role (fails)', assertFails(setDoc(doc(O, 'invites/new-bad@x.com'), { householdId: 'H', role: 'superadmin' })));
  await check('caregiver creates an invite (non-owner, fails)', assertFails(setDoc(doc(C, 'invites/new-x@x.com'), { householdId: 'H', role: 'caregiver' })));

  console.log('\nHousehold create — maternal-blob guard at CREATE (2026-07-12 hardening):');
  await check('create a household with a CLEAN app blob (succeeds)', assertSucceeds(setDoc(doc(S, 'households/HS-clean'), { ownerId: 'S', members: { S: 'owner' }, memberInfo: { S: { name: 'Solo' } }, app: cleanApp() })));
  await check('create a household with pregnancy pre-seeded in the blob (fails)', assertFails(setDoc(doc(S, 'households/HS-preg'), { ownerId: 'S', members: { S: 'owner' }, memberInfo: {}, app: cleanApp({ pregnancy: { weeks: 8 } }) })));
  await check('create a household with mhealth pre-seeded in the blob (fails)', assertFails(setDoc(doc(S, 'households/HS-mh'), { ownerId: 'S', members: { S: 'owner' }, memberInfo: {}, app: cleanApp({ mhealth: { mood: 'x' } }) })));

  // Account deletion (A6, App Store 5.1.1(v)). The departingSelf() branch has to let a CAREGIVER
  // walk out unaided — the isMember() branch freezes the members map, so without it a caregiver
  // could not delete their own account without an owner's help. It must not become a back door.
  console.log('\nAccount deletion — self-departure (A6):');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // HD: owner O2 + caregivers C2 and C3, so a departure still leaves the circle populated.
    await setDoc(doc(db, 'households/HD'), {
      ownerId: 'O2', members: { O2: 'owner', C2: 'caregiver', C3: 'caregiver' },
      memberInfo: { O2: { name: 'Mom' }, C2: { name: 'Dad' }, C3: { name: 'Nana' } }, app: cleanApp()
    });
    await setDoc(doc(db, 'invites/c2@x.com'), { householdId: 'HD', role: 'caregiver' });
  });
  const C2 = env.authenticatedContext('C2', { email: 'c2@x.com' }).firestore();
  const C3 = env.authenticatedContext('C3', { email: 'c3@x.com' }).firestore();
  const O2 = env.authenticatedContext('O2', { email: 'o2@x.com' }).firestore();
  const gone = require('firebase/firestore').deleteField;

  await check('caregiver removes ONLY themselves + own tombstone (succeeds)', assertSucceeds(updateDoc(doc(C2, 'households/HD'), {
    'members.C2': gone(), 'memberInfo.C2': gone(), 'formerMemberInfo.C2': { name: '', relationship: 'Papa Bear', avatar: null }
  })));
  await check('caregiver deletes the invite addressed to their OWN email (succeeds)', assertSucceeds(deleteDoc(doc(C2, 'invites/c2@x.com'))));
  // The same branch must not become a way to attack anyone else.
  await check('caregiver removes ANOTHER member while leaving (fails)', assertFails(updateDoc(doc(C3, 'households/HD'), {
    'members.C3': gone(), 'members.O2': gone(), 'memberInfo.C3': gone()
  })));
  await check('caregiver leaves but promotes themselves owner (fails)', assertFails(updateDoc(doc(C3, 'households/HD'), {
    'members.C3': 'owner', 'memberInfo.C3': gone()
  })));
  await check('caregiver leaves and re-points ownerId at themselves (fails)', assertFails(updateDoc(doc(C3, 'households/HD'), {
    'members.C3': gone(), 'memberInfo.C3': gone(), ownerId: 'C3'
  })));
  await check('caregiver leaves and writes SOMEONE ELSE\'s tombstone (fails)', assertFails(updateDoc(doc(C3, 'households/HD'), {
    'members.C3': gone(), 'memberInfo.C3': gone(), 'formerMemberInfo.O2': { name: 'x' }
  })));
  await check('caregiver leaves and smuggles a deleteAfter onto the household (fails)', assertFails(updateDoc(doc(C3, 'households/HD'), {
    'members.C3': gone(), 'memberInfo.C3': gone(), deleteAfter: 1
  })));
  await check('caregiver leaves and edits the shared app blob in the same write (fails)', assertFails(updateDoc(doc(C3, 'households/HD'), {
    'members.C3': gone(), 'memberInfo.C3': gone(), app: cleanApp({ babies: [{ name: 'x' }] })
  })));
  await check('caregiver leaves and grants themselves Pro (fails)', assertFails(updateDoc(doc(C3, 'households/HD'), {
    'members.C3': gone(), 'memberInfo.C3': gone(), pro: { plan: 'yearly' }
  })));
  await check('stranger tries the departure shape on a household they are not in (fails)', assertFails(updateDoc(doc(S, 'households/HD'), {
    'members.S': gone(), 'memberInfo.S': gone()
  })));
  await check('caregiver deletes an invite for SOMEONE ELSE\'s email (fails)', assertFails(deleteDoc(doc(C3, 'invites/inv@x.com'))));
  // A departing owner needs the fuller update (successor + ownerId), which isOwner() already covers
  // because it reads the pre-write state.
  await check('owner leaves, promoting a successor in the same write (succeeds)', assertSucceeds(updateDoc(doc(O2, 'households/HD'), {
    'members.O2': gone(), 'memberInfo.O2': gone(), 'members.C3': 'owner', ownerId: 'C3',
    'formerMemberInfo.O2': { name: '', relationship: 'Mama Bear', avatar: null }
  })));

  console.log('\nAccount deletion — sole owner flags the household (A6):');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'households/HSOLO'), {
      ownerId: 'S2', members: { S2: 'owner' }, memberInfo: { S2: { name: 'Solo' } }, app: cleanApp()
    });
  });
  const S2 = env.authenticatedContext('S2', { email: 's2@x.com' }).firestore();
  await check('sole owner sets deleteAfter and removes themselves (succeeds)', assertSucceeds(updateDoc(doc(S2, 'households/HSOLO'), {
    'members.S2': gone(), 'memberInfo.S2': gone(), deleteAfter: 1, deletionRequestedBy: 'S2'
  })));
  await check('a stranger cannot flag someone else\'s household for deletion (fails)', assertFails(updateDoc(doc(S, 'households/H'), { deleteAfter: 1 })));

  await env.cleanup();
  console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
  process.exit(results.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
