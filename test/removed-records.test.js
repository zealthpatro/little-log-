'use strict';
/* A mother the owner removes can still erase her OWN maternal records, and nobody else gains anything.
 * November 2026 review, D2 (privacy, medium).
 *
 * What was wrong. Her pregnancy journey, her private health and her pregnancy photo bytes live under
 * the household (mhealth/{uid}/cat/*, pregnancy/{uid}, pregnancy/{uid}/photos/*), and every rule
 * there asked for membership first. Once an owner removed her, she could neither find nor delete any
 * of it, while the people she had shared it with (still members) could go on reading it. Account
 * deletion could not reach it either: the private-records-first step ran into the same wall.
 *
 * The fix gives the record's own uid two things there, without membership: LIST her own
 * subcollections and DELETE her own documents, plus a GET of her own journey document so the app can
 * tell whether there is anything to offer. Nothing else becomes readable or writable, to her or to
 * anyone, and sharedWith keeps meaning exactly what it meant.
 *
 * Sections:
 *   1. Mia, removed, finds and deletes everything of hers: health categories (mood included), the
 *      journey, its photo bytes, and a kept-after-loss photo whose journey doc is already gone.
 *   2. Nobody else can delete hers: the household owner, the partner she shared with, a caregiver,
 *      another mother, another removed member, a stranger. Each attack runs on freshly seeded data.
 *   3. Mia, removed, still cannot read anything that is not hers, including records another mother
 *      shared with her, and cannot write her own records back.
 *   4. The household owner still cannot read or list what Mia never shared; the partner reads only
 *      what she shared, mood never, and nothing once she has deleted it.
 *   5. The 866851ac client, for a mother still in the family, under these rules: every write it makes
 *      still lands (old client shapes against new rules), so nothing is spent or stranded.
 *
 *   cd test && npx firebase-tools emulators:exec --only firestore --project demo-cubby "node removed-records.test.js"
 *   ... "node removed-records.test.js --rules=/abs/path/old.rules"   grade another rules file (red runs)
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, limit, where, setLogLevel } = require('firebase/firestore');
setLogLevel('silent'); // every refusal below is expected; the SDK would print each one as a warning

const RULES_ARG = process.argv.find((a) => a.startsWith('--rules='));
const RULES_PATH = RULES_ARG ? RULES_ARG.slice('--rules='.length) : path.join(__dirname, '..', 'firestore.rules');
const RULES = fs.readFileSync(RULES_PATH, 'utf8');

let pass = 0, fail = 0;
async function check(name, p) {
  try { await p; pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '   (' + ((e && e.message) || e).toString().split('\n')[0] + ')'); }
}
async function expectTrue(name, fn) {
  try { const v = await fn(); if (v === true) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '   (got ' + JSON.stringify(v) + ')'); } }
  catch (e) { fail++; console.log('  FAIL ' + name + '   (' + ((e && e.message) || e).toString().split('\n')[0] + ')'); }
}

const cleanApp = () => ({ babies: [], settings: {}, milestones: [], meds: [], vaccines: {}, illnesses: [],
  photos: [], handoff: null, den: null, consents: [], guardians: null, timers: {} });
const CATS = ['health', 'careteam', 'conditions', 'mood'];

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-cubby', firestore: { rules: RULES } });
  console.log('\nremoved mother, her own records (rules: ' + RULES_PATH + ')');
  const as = (uid) => env.authenticatedContext(uid, { email: uid.toLowerCase() + '@x.com', email_verified: true }).firestore();
  const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
  const exists = (p) => admin(async (db) => (await getDoc(doc(db, p))).exists());

  /* H: Olive owns it. Mia (removed below) and Mae are both expecting; Pat is Mia's partner, the one
     person she shared with; Cal is a caregiver nobody shared with. Rex was removed before. Sam is a
     stranger. Mae shares her health and journey with Mia, so "Mia cannot read anyone else's" has a
     record that was once readable to her to test against. */
  const seed = async () => { await env.clearFirestore(); await admin(async (db) => {
    await setDoc(doc(db, 'households/H'), {
      ownerId: 'Olive', members: { Olive: 'owner', Mia: 'caregiver', Mae: 'caregiver', Pat: 'caregiver', Cal: 'caregiver' },
      memberInfo: { Olive: { name: 'Olive', role: 'owner' }, Mia: { name: 'Mia', role: 'caregiver' }, Mae: { name: 'Mae', role: 'caregiver' },
        Pat: { name: 'Pat', role: 'caregiver' }, Cal: { name: 'Cal', role: 'caregiver' } },
      app: cleanApp(),
    });
    for (const c of CATS) {
      await setDoc(doc(db, 'households/H/mhealth/Mia/cat/' + c), { ownerUid: 'Mia', category: c, data: { note: 'mia-' + c }, sharedWith: c === 'health' ? ['Pat'] : [] });
      await setDoc(doc(db, 'households/H/mhealth/Mae/cat/' + c), { ownerUid: 'Mae', category: c, data: { note: 'mae-' + c }, sharedWith: c === 'mood' ? [] : ['Mia', 'Pat'] });
    }
    await setDoc(doc(db, 'households/H/pregnancy/Mia'), { ownerUid: 'Mia', data: { stage: 'expecting', precon: [] }, sharedWith: ['Pat'] });
    await setDoc(doc(db, 'households/H/pregnancy/Mia/photos/bump1'), { data: 'MIA-BYTES-1', authorId: 'Mia' });
    await setDoc(doc(db, 'households/H/pregnancy/Mia/photos/scan2'), { data: 'MIA-BYTES-2', authorId: 'Mia' });
    await setDoc(doc(db, 'households/H/pregnancy/Mae'), { ownerUid: 'Mae', data: { stage: 'expecting' }, sharedWith: ['Mia', 'Pat'] });
    await setDoc(doc(db, 'households/H/pregnancy/Mae/photos/m1'), { data: 'MAE-BYTES', authorId: 'Mae' });
    // A kept-after-loss photo: Rex's journey doc is gone (pregClear), the kept bytes remain.
    await setDoc(doc(db, 'households/H/pregnancy/Rex/photos/kept1'), { data: 'REX-BYTES', authorId: 'Rex' });
    await setDoc(doc(db, 'households/H/mhealth/Rex/cat/health'), { ownerUid: 'Rex', category: 'health', data: {}, sharedWith: [] });
  }); };
  // Olive removes Mia: out of members and memberInfo, a bear label kept in formerMemberInfo.
  const removeMia = () => admin(async (db) => {
    const d = (await getDoc(doc(db, 'households/H'))).data();
    delete d.members.Mia; delete d.memberInfo.Mia;
    d.formerMemberInfo = { Mia: { name: 'Mia', relationship: 'Mama Bear', avatar: null } };
    await setDoc(doc(db, 'households/H'), d);
  });

  await seed(); await removeMia();
  await expectTrue('(Mia really is out of the family)', () => admin(async (db) => !((await getDoc(doc(db, 'households/H'))).data().members.Mia)));

  /* ------------------------------------------------------------------------------------------- */
  console.log('\n1. Mia, removed, finds and deletes everything of hers');
  const M = as('Mia');
  await check('she lists her own health categories', assertSucceeds(getDocs(collection(M, 'households/H/mhealth/Mia/cat'))));
  await expectTrue('and the listing finds all four, mood included', async () => (await getDocs(collection(M, 'households/H/mhealth/Mia/cat'))).size === 4);
  await check('she lists her own pregnancy photos', assertSucceeds(getDocs(collection(M, 'households/H/pregnancy/Mia/photos'))));
  await check('she can tell her journey is there', assertSucceeds(getDoc(doc(M, 'households/H/pregnancy/Mia'))));
  await check('a one-item probe of each, as the app asks on her screen', assertSucceeds(Promise.all([
    getDocs(query(collection(M, 'households/H/mhealth/Mia/cat'), limit(1))),
    getDocs(query(collection(M, 'households/H/pregnancy/Mia/photos'), limit(1))),
  ])));
  for (const c of CATS) await check('she deletes her ' + c + ' category', assertSucceeds(deleteDoc(doc(M, 'households/H/mhealth/Mia/cat/' + c))));
  await check('she deletes her journey', assertSucceeds(deleteDoc(doc(M, 'households/H/pregnancy/Mia'))));
  await check('she deletes a photo', assertSucceeds(deleteDoc(doc(M, 'households/H/pregnancy/Mia/photos/bump1'))));
  await check('and the other, with her journey doc already gone', assertSucceeds(deleteDoc(doc(M, 'households/H/pregnancy/Mia/photos/scan2'))));
  await expectTrue('nothing of hers is left under the family (read back with rules off)', async () => {
    const left = await admin(async (db) => {
      const a = await getDocs(collection(db, 'households/H/mhealth/Mia/cat'));
      const b = await getDocs(collection(db, 'households/H/pregnancy/Mia/photos'));
      const c = await getDoc(doc(db, 'households/H/pregnancy/Mia'));
      return a.size + b.size + (c.exists() ? 1 : 0);
    });
    return left === 0 || left;
  });
  await expectTrue('and Mae\'s records are untouched', async () => (await exists('households/H/pregnancy/Mae')) && (await exists('households/H/mhealth/Mae/cat/health')) && (await exists('households/H/pregnancy/Mae/photos/m1')));
  const R = as('Rex');
  await check('Rex, removed earlier after a kept loss, lists his kept photo bytes', assertSucceeds(getDocs(collection(R, 'households/H/pregnancy/Rex/photos'))));
  await check('and deletes them', assertSucceeds(deleteDoc(doc(R, 'households/H/pregnancy/Rex/photos/kept1'))));
  await check('deleting a journey that is not there is not an error (nothing to find)', assertSucceeds(deleteDoc(doc(R, 'households/H/pregnancy/Rex'))));

  /* ------------------------------------------------------------------------------------------- */
  console.log('\n2. nobody else can delete hers (fresh data for every attempt)');
  const others = [['Olive, the household owner', 'Olive'], ['Pat, the partner she shared with', 'Pat'], ['Cal, a caregiver', 'Cal'],
    ['Mae, another mother', 'Mae'], ['Rex, another removed member', 'Rex'], ['Sam, a stranger', 'Sam']];
  for (const [label, uid] of others) {
    const X = as(uid);
    await seed(); await removeMia();
    await check(label + ': deletes her health (fails)', assertFails(deleteDoc(doc(X, 'households/H/mhealth/Mia/cat/health'))));
    await check(label + ': deletes her mood (fails)', assertFails(deleteDoc(doc(X, 'households/H/mhealth/Mia/cat/mood'))));
    await check(label + ': deletes her journey (fails)', assertFails(deleteDoc(doc(X, 'households/H/pregnancy/Mia'))));
    await check(label + ': deletes a photo of hers (fails)', assertFails(deleteDoc(doc(X, 'households/H/pregnancy/Mia/photos/bump1'))));
    await check(label + ': lists her health categories (fails)', assertFails(getDocs(collection(X, 'households/H/mhealth/Mia/cat'))));
    if (uid !== 'Pat') await check(label + ': lists her photos (fails)', assertFails(getDocs(collection(X, 'households/H/pregnancy/Mia/photos'))));
    await expectTrue(label + ': all of hers is still there', async () => (await exists('households/H/mhealth/Mia/cat/health')) && (await exists('households/H/mhealth/Mia/cat/mood'))
      && (await exists('households/H/pregnancy/Mia')) && (await exists('households/H/pregnancy/Mia/photos/bump1')));
  }
  // The same while she is still in the family: membership was never what kept these out.
  await seed();
  await check('before any removal, Olive deletes Mia\'s journey (fails)', assertFails(deleteDoc(doc(as('Olive'), 'households/H/pregnancy/Mia'))));
  await check('before any removal, Pat deletes Mia\'s health (fails)', assertFails(deleteDoc(doc(as('Pat'), 'households/H/mhealth/Mia/cat/health'))));

  /* ------------------------------------------------------------------------------------------- */
  console.log('\n3. Mia, removed, still cannot read anything that is not hers, or write her own back');
  await seed(); await removeMia();
  const M3 = as('Mia');
  await check('Mae\'s health, shared with Mia while she was in (fails)', assertFails(getDoc(doc(M3, 'households/H/mhealth/Mae/cat/health'))));
  await check('Mae\'s journey, shared with Mia (fails)', assertFails(getDoc(doc(M3, 'households/H/pregnancy/Mae'))));
  await check('Mae\'s photo bytes (fails)', assertFails(getDoc(doc(M3, 'households/H/pregnancy/Mae/photos/m1'))));
  await check('a listing of Mae\'s health (fails)', assertFails(getDocs(collection(M3, 'households/H/mhealth/Mae/cat'))));
  await check('a listing of Mae\'s photos (fails)', assertFails(getDocs(collection(M3, 'households/H/pregnancy/Mae/photos'))));
  await check('a listing of every journey in the family (fails)', assertFails(getDocs(collection(M3, 'households/H/pregnancy'))));
  await check('a listing of every journey that names her as owner (fails)', assertFails(getDocs(query(collection(M3, 'households/H/pregnancy'), where('ownerUid', '==', 'Mia')))));
  await check('the family document (fails)', assertFails(getDoc(doc(M3, 'households/H'))));
  await check('the family\'s events (fails)', assertFails(getDocs(collection(M3, 'households/H/events'))));
  await check('she deletes Mae\'s journey (fails)', assertFails(deleteDoc(doc(M3, 'households/H/pregnancy/Mae'))));
  await check('she deletes Mae\'s health (fails)', assertFails(deleteDoc(doc(M3, 'households/H/mhealth/Mae/cat/health'))));
  await check('she writes her own health back in (fails)', assertFails(setDoc(doc(M3, 'households/H/mhealth/Mia/cat/health'), { ownerUid: 'Mia', category: 'health', data: {}, sharedWith: ['Pat'] })));
  await check('she rewrites her journey, say to widen sharedWith (fails)', assertFails(updateDoc(doc(M3, 'households/H/pregnancy/Mia'), { sharedWith: ['Pat', 'Cal'] })));
  await check('she adds a photo (fails)', assertFails(setDoc(doc(M3, 'households/H/pregnancy/Mia/photos/new'), { data: 'x', authorId: 'Mia' })));
  // Another family entirely. Her uid owns nothing there, so the listing is empty and changes nothing.
  await admin((db) => setDoc(doc(db, 'households/H9'), { ownerId: 'Zed', members: { Zed: 'owner' }, memberInfo: {}, app: cleanApp() }));
  await admin((db) => setDoc(doc(db, 'households/H9/pregnancy/Zed'), { ownerUid: 'Zed', data: {}, sharedWith: [] }));
  await check('in a family she was never in, Zed\'s journey (fails)', assertFails(getDoc(doc(M3, 'households/H9/pregnancy/Zed'))));
  await expectTrue('and her own path there holds nothing to find', async () => (await getDocs(collection(M3, 'households/H9/mhealth/Mia/cat'))).size === 0);

  /* ------------------------------------------------------------------------------------------- */
  console.log('\n4. sharedWith means what it meant: the owner still cannot read what was never shared');
  await seed(); await removeMia();
  const O = as('Olive'), P = as('Pat'), C = as('Cal');
  await check('Olive reads Mia\'s journey (never shared with her) (fails)', assertFails(getDoc(doc(O, 'households/H/pregnancy/Mia'))));
  await check('Olive reads Mia\'s health (fails)', assertFails(getDoc(doc(O, 'households/H/mhealth/Mia/cat/health'))));
  await check('Olive reads Mia\'s mood (fails)', assertFails(getDoc(doc(O, 'households/H/mhealth/Mia/cat/mood'))));
  await check('Olive reads a photo of Mia\'s (fails)', assertFails(getDoc(doc(O, 'households/H/pregnancy/Mia/photos/bump1'))));
  await check('Olive lists Mia\'s photos (fails)', assertFails(getDocs(collection(O, 'households/H/pregnancy/Mia/photos'))));
  await check('Cal reads Mia\'s journey (fails)', assertFails(getDoc(doc(C, 'households/H/pregnancy/Mia'))));
  await check('Pat, whom she told, still reads her journey while it exists', assertSucceeds(getDoc(doc(P, 'households/H/pregnancy/Mia'))));
  await check('and her shared health', assertSucceeds(getDoc(doc(P, 'households/H/mhealth/Mia/cat/health'))));
  await check('but never her mood (fails)', assertFails(getDoc(doc(P, 'households/H/mhealth/Mia/cat/mood'))));
  await check('nor her conditions, which she did not share (fails)', assertFails(getDoc(doc(P, 'households/H/mhealth/Mia/cat/conditions'))));
  // Mia deletes; the very thing D2 is for.
  await check('Mia, removed, deletes her journey and her shared health', assertSucceeds(Promise.all([deleteDoc(doc(as('Mia'), 'households/H/pregnancy/Mia')), deleteDoc(doc(as('Mia'), 'households/H/mhealth/Mia/cat/health'))])));
  await expectTrue('once she deletes them, Pat finds nothing', async () => {
    const a = await getDoc(doc(P, 'households/H/pregnancy/Mia')).then((s) => s.exists(), () => false);
    const b = await getDoc(doc(P, 'households/H/mhealth/Mia/cat/health')).then((s) => s.exists(), () => false);
    return (!a && !b) || { journey: a, health: b };
  });

  /* ------------------------------------------------------------------------------------------- */
  console.log('\n5. the 866851ac client, for a mother still in the family, under these rules');
  await seed();
  const Mae = as('Mae'), Pt = as('Pat');
  // matSetShared / syncMaternal: set({ownerUid, category, data, sharedWith, updatedAt})
  await check('her health save (matSetShared shape)', assertSucceeds(setDoc(doc(Mae, 'households/H/mhealth/Mae/cat/health'), { ownerUid: 'Mae', category: 'health', data: { weights: [] }, sharedWith: ['Pat'], updatedAt: 1 })));
  await check('her mood save, never shared', assertSucceeds(setDoc(doc(Mae, 'households/H/mhealth/Mae/cat/mood'), { ownerUid: 'Mae', category: 'mood', data: { moodLog: [] }, sharedWith: [], updatedAt: 1 })));
  await check('mood with a sharedWith list is still refused (fails)', assertFails(setDoc(doc(Mae, 'households/H/mhealth/Mae/cat/mood'), { ownerUid: 'Mae', category: 'mood', data: {}, sharedWith: ['Pat'] })));
  // pregSetShared: set({ownerUid, data, sharedWith, updatedAt})
  await check('her journey save (pregSetShared shape)', assertSucceeds(setDoc(doc(Mae, 'households/H/pregnancy/Mae'), { ownerUid: 'Mae', data: { stage: 'expecting', precon: [] }, sharedWith: ['Pat'], updatedAt: 1 })));
  await check('Pat ticks the shared checklist (preconOnly)', assertSucceeds(updateDoc(doc(Pt, 'households/H/pregnancy/Mae'), { 'data.precon': [{ id: 'p1', done: true }], updatedAt: 2 })));
  await check('her photo bytes (savePregPhoto shape)', assertSucceeds(setDoc(doc(Mae, 'households/H/pregnancy/Mae/photos/b9'), { data: 'BYTES', authorId: 'Mae' })));
  await check('her own listeners: her categories, her journey, her photos', assertSucceeds(Promise.all([
    getDocs(collection(Mae, 'households/H/mhealth/Mae/cat')), getDoc(doc(Mae, 'households/H/pregnancy/Mae')), getDocs(collection(Mae, 'households/H/pregnancy/Mae/photos'))])));
  await check('Pat\'s listener on her shared category', assertSucceeds(getDoc(doc(Pt, 'households/H/mhealth/Mae/cat/health'))));
  // matClear + pregClear + a photo delete (removePregPhoto)
  await check('she removes a photo', assertSucceeds(deleteDoc(doc(Mae, 'households/H/pregnancy/Mae/photos/b9'))));
  await check('she clears her categories (matClear)', assertSucceeds(Promise.all(CATS.map((c) => deleteDoc(doc(Mae, 'households/H/mhealth/Mae/cat/' + c))))));
  await check('she closes her journey (pregClear)', assertSucceeds(deleteDoc(doc(Mae, 'households/H/pregnancy/Mae'))));
  // deleteAccount step 1 for a member, as 866851ac runs it: list then delete, while still a member.
  await check('a member\'s account deletion, step 1 (list and delete her own)', assertSucceeds((async () => {
    const cats = await getDocs(collection(Mae, 'households/H/mhealth/Mae/cat'));
    await Promise.all(cats.docs.map((d) => deleteDoc(d.ref)));
    const ph = await getDocs(collection(Mae, 'households/H/pregnancy/Mae/photos'));
    await Promise.all(ph.docs.map((d) => deleteDoc(d.ref)));
  })()));

  await env.cleanup();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('REMOVED-RECORDS: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
