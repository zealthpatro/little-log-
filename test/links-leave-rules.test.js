'use strict';
/* Invite-link secrecy and simultaneous account deletions, proved against the Firestore emulator.
 * November 2026 review, lane B: D1 (link tokens readable by every member) and D4 (two deletions at
 * the same moment).
 *
 * D1. households/{hid}.pendingLinks is read by every member, and it used to be keyed by each live
 *     link's secret token, so any caregiver could copy one and hand it to anyone. Now the circle's
 *     list is keyed by a row id that opens nothing; the token lives in households/{hid}/ownerLinks,
 *     which only an owner can read or write; the link carries its row id, so a joiner clears her
 *     own row and nothing else. Links minted before keep the token-keyed form, and still work.
 * D4. The owner (handing over to an heir) and the heir (leaving) delete their accounts at once. With
 *     the 866851ac client's own writes, interleaved, the family ended either with the departed heir
 *     written back in as owner, or with nobody in it and no deletion scheduled (never purged).
 *     Now an owner's write may not add anyone to members, and a write that empties members must
 *     schedule the deletion (the last one out), whoever makes it.
 *
 * Every write here is in the exact shape a client sends: the NEW client (app/store-firebase.js on
 * this branch) and the 866851ac client, which is what phones will still be running when these rules
 * are published. Each attack is a MUST FAIL; each real write a MUST SUCCEED.
 *
 * Run from test/ (tools/gates.js EMU tier does exactly this):
 *   npx firebase-tools emulators:exec --only firestore --project demo-cubby "node links-leave-rules.test.js"
 * --rules=<file> grades another rules file (the pristine base, to watch the new assertions fail).
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app').default || require('firebase/compat/app');
require('firebase/compat/firestore');

const RULES_ARG = process.argv.find((a) => a.startsWith('--rules='));
const RULES_PATH = RULES_ARG ? RULES_ARG.slice('--rules='.length) : path.join(__dirname, '..', 'firestore.rules');
const RULES = fs.readFileSync(RULES_PATH, 'utf8');

const FV = firebase.firestore.FieldValue;
const FP = firebase.firestore.FieldPath;
const del = () => FV.delete();
const ts = () => FV.serverTimestamp();
const DAY = 24 * 60 * 60 * 1000;
const inHours = (h) => new Date(Date.now() + h * 3600000);

let pass = 0, fail = 0;
async function check(name, p) {
  try { await p; pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '   (' + ((e && e.message) || e).toString().split('\n')[0] + ')'); }
}
async function checkOn(reseed, name, fn) { await reseed(); return check(name, fn()); }

// Tokens are 22 base62 characters (newInviteToken); row ids are 'r_' + 16 (newLinkRowId).
const TOKA = 'AaaaaaaaaaaaaaaaaaaaA1', TOKB = 'BbbbbbbbbbbbbbbbbbbbB2', TOKL = 'LlllllllllllllllllllL3', TOKN = 'NnnnnnnnnnnnnnnnnnnnN4';
const ROWA = 'r_aaaaaaaaaaaaaaaa', ROWB = 'r_bbbbbbbbbbbbbbbb', ROWN = 'r_nnnnnnnnnnnnnnnn', ROWM = 'r_mmmmmmmmmmmmmmmm';
const row = () => ({ at: Date.now(), expiresAt: Date.now() + DAY, sentTo: '' });
const cleanApp = () => ({ babies: [], settings: {}, milestones: [], meds: [], vaccines: {}, illnesses: [],
  photos: [], handoff: null, den: null, consents: [], guardians: null, timers: {} });
// memberUpdate() in app/store-firebase.js.
function memberUpdate(uid, role) {
  const u = {};
  u['members.' + uid] = role;
  u['memberInfo.' + uid] = { name: 'Joiner', photoURL: '', role, relationship: 'Auntie Bear', joinedAt: ts() };
  return u;
}
// The link join, claim + consume + join in one batch (claimInviteLink). `clearKey` is the pending row
// the client clears: the row id for a link that carries one, else the token (and, for the 866851ac
// client, always the token).
function linkJoin(db, hid, uid, token, clearKeys) {
  const upd = Object.assign({ joinToken: token }, memberUpdate(uid, 'caregiver'));
  (Array.isArray(clearKeys) ? clearKeys : [clearKeys]).forEach((k) => { upd['pendingLinks.' + k] = del(); });
  const b = db.batch();
  b.update(db.doc('inviteLinks/' + token), { usedBy: uid, consumed: true });
  b.update(db.doc('households/' + hid), upd);
  return b.commit();
}

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-cubby', firestore: { rules: RULES } });
  await env.clearFirestore();
  const as = (uid, email) => env.authenticatedContext(uid, { email: email || (uid.toLowerCase() + '@x.com'), email_verified: true }).firestore();
  const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
  const readAdmin = async (p) => { let d; await seed(async (db) => { d = (await db.doc(p).get()); }); return d; };
  console.log('\nlink secrecy and simultaneous deletions (' + (RULES_ARG ? RULES_PATH : 'firestore.rules') + ')');

  /* ---------------------------------------------------------------------------------------------
     1. D1: the token is somewhere only an owner can read. */
  const linkSeed = () => seed(async (db) => {
    await env.clearFirestore();
    await db.doc('households/HL').set({
      ownerId: 'O', members: { O: 'owner', C: 'caregiver' },
      memberInfo: { O: { name: 'Olive', role: 'owner' }, C: { name: 'Carl', role: 'caregiver' } },
      // ROWA and ROWB: new links, keyed by row id. TOKL: a link minted before, keyed by its token.
      pendingLinks: { [ROWA]: row(), [ROWB]: row(), [TOKL]: row() },
      app: cleanApp()
    });
    await db.doc('households/HL/ownerLinks/' + ROWA).set({ token: TOKA, at: 1, expiresAt: Date.now() + DAY });
    await db.doc('households/HL/ownerLinks/' + ROWB).set({ token: TOKB, at: 1, expiresAt: Date.now() + DAY });
    const lk = (rowId) => Object.assign({ householdId: 'HL', role: 'caregiver', usedBy: null, expiresAt: inHours(24), invitedBy: 'O' }, rowId ? { rowId } : {});
    await db.doc('inviteLinks/' + TOKA).set(lk(ROWA));
    await db.doc('inviteLinks/' + TOKB).set(lk(ROWB));
    await db.doc('inviteLinks/' + TOKL).set(lk(null));
    await db.doc('households/HOTHER').set({ ownerId: 'Z', members: { Z: 'owner' }, memberInfo: { Z: { name: 'Zed', role: 'owner' } }, app: cleanApp() });
  });
  const O = as('O'), C = as('C'), J = as('J'), S = as('S'), Z = as('Z');

  console.log('\n1. the owner keeps her links (must SUCCEED)');
  await linkSeed();
  await check('the owner reads a link\'s token by its row id', assertSucceeds(O.doc('households/HL/ownerLinks/' + ROWA).get()));
  await check('the owner lists her links (her listener)', assertSucceeds(O.collection('households/HL/ownerLinks').get()));
  await check('the owner mints a link: token doc, link with its row id, and the row, in one batch', (async () => {
    const b = O.batch();
    b.set(O.doc('households/HL/ownerLinks/' + ROWN), { token: TOKN, at: Date.now(), expiresAt: Date.now() + DAY });
    b.set(O.doc('inviteLinks/' + TOKN), { householdId: 'HL', role: 'caregiver', relationship: '', invitedBy: 'O', invitedByName: 'Olive',
      fromEmail: 'o@x.com', usedBy: null, createdAt: ts(), expiresAt: inHours(24), rowId: ROWN });
    b.update(O.doc('households/HL'), new FP('pendingLinks', ROWN), row());
    await assertSucceeds(b.commit());
  })());
  await check('the owner records who it was emailed to, on the row', assertSucceeds(O.doc('households/HL').update(new FP('pendingLinks', ROWN, 'sentTo'), 'aunt@x.com')));
  await check('the owner moves a legacy row to a row id: token doc, the link learns its row, the row moves (one batch)', (async () => {
    const b = O.batch();
    b.set(O.doc('households/HL/ownerLinks/' + ROWM), { token: TOKL, at: 1, expiresAt: Date.now() + DAY, sentTo: '' });
    b.update(O.doc('inviteLinks/' + TOKL), { rowId: ROWM });
    b.update(O.doc('households/HL'), new FP('pendingLinks', TOKL), del(), new FP('pendingLinks', ROWM), row());
    await assertSucceeds(b.commit());
  })());
  await check('the owner cancels: the link, its row and its token doc', (async () => {
    await assertSucceeds(O.doc('inviteLinks/' + TOKB).delete());
    await assertSucceeds(O.doc('households/HL').update(new FP('pendingLinks', ROWB), del()));
    await assertSucceeds(O.doc('households/HL/ownerLinks/' + ROWB).delete());
  })());

  console.log('\n1b. nobody else can reach a token (must FAIL)');
  await linkSeed();
  await check('a caregiver reads a token doc', assertFails(C.doc('households/HL/ownerLinks/' + ROWA).get()));
  await check('a caregiver lists the token docs', assertFails(C.collection('households/HL/ownerLinks').get()));
  await check('a caregiver lists inviteLinks', assertFails(C.collection('inviteLinks').get()));
  await check('a caregiver queries inviteLinks by household', assertFails(C.collection('inviteLinks').where('householdId', '==', 'HL').get()));
  await check('a stranger reads a token doc', assertFails(S.doc('households/HL/ownerLinks/' + ROWA).get()));
  await check('another family\'s owner reads a token doc', assertFails(Z.doc('households/HL/ownerLinks/' + ROWA).get()));
  await check('a caregiver plants a token doc', assertFails(C.doc('households/HL/ownerLinks/r_evilevilevilevil').set({ token: 'x', at: 1 })));
  await check('a caregiver rewrites a token doc', assertFails(C.doc('households/HL/ownerLinks/' + ROWA).set({ token: TOKB, at: 1 })));
  await check('a caregiver deletes a token doc', assertFails(C.doc('households/HL/ownerLinks/' + ROWA).delete()));
  await check('an owner writes a token doc with no token in it', assertFails(O.doc('households/HL/ownerLinks/r_notokennotokenno').set({ at: 1 })));
  await check('an owner mints a link whose row id is not a string', assertFails(O.doc('inviteLinks/' + TOKN).set({ householdId: 'HL', role: 'caregiver',
    invitedBy: 'O', usedBy: null, expiresAt: inHours(24), rowId: 7 })));
  await check('a caregiver reads an owner-only row through a collection-group query', assertFails(C.collectionGroup('ownerLinks').get()));

  console.log('\n2. joining by link (must SUCCEED)');
  await linkSeed();
  await check('new client, new link: claim + join + clear ITS row (by row id), one batch', assertSucceeds(linkJoin(J, 'HL', 'J', TOKA, ROWA)));
  await check('and only that row went', (async () => {
    const d = (await readAdmin('households/HL')).data();
    if (ROWA in d.pendingLinks || !(ROWB in d.pendingLinks) || !(TOKL in d.pendingLinks)) throw new Error(JSON.stringify(Object.keys(d.pendingLinks)));
  })());
  await checkOn(linkSeed, 'a link minted before (no row id): the token-keyed row is cleared, as before', () => assertSucceeds(linkJoin(J, 'HL', 'J', TOKL, TOKL)));
  await checkOn(linkSeed, 'the 866851ac client on a NEW link (clears the token key, which is not there): joins, nothing stranded', async () => {
    await assertSucceeds(linkJoin(J, 'HL', 'J', TOKA, TOKA));
    const h = (await readAdmin('households/HL')).data(), l = (await readAdmin('inviteLinks/' + TOKA)).data();
    if (h.members.J !== 'caregiver' || l.consumed !== true || l.usedBy !== 'J') throw new Error('joined ' + h.members.J + ' / link ' + JSON.stringify(l));
  });

  console.log('\n2b. joining by link (attacks must FAIL)');
  await checkOn(linkSeed, 'a joiner clears ANOTHER new link\'s row', () => assertFails(linkJoin(J, 'HL', 'J', TOKA, ROWB)));
  await checkOn(linkSeed, 'a joiner clears her own row AND another', () => assertFails(linkJoin(J, 'HL', 'J', TOKA, [ROWA, ROWB])));
  await checkOn(linkSeed, 'a joiner on a new link clears the legacy token row', () => assertFails(linkJoin(J, 'HL', 'J', TOKA, TOKL)));
  await checkOn(linkSeed, 'a joiner on a legacy link clears a new link\'s row', () => assertFails(linkJoin(J, 'HL', 'J', TOKL, ROWA)));
  await checkOn(linkSeed, 'a joiner rewrites the link\'s row id in her claim', async () => {
    const upd = Object.assign({ joinToken: TOKA, ['pendingLinks.' + ROWB]: del() }, memberUpdate('J', 'caregiver'));
    const b = J.batch();
    b.update(J.doc('inviteLinks/' + TOKA), { usedBy: 'J', consumed: true, rowId: ROWB });
    b.update(J.doc('households/HL'), upd);
    await assertFails(b.commit());
  });

  /* ---------------------------------------------------------------------------------------------
     3. D4: two deletions at once. The writes below are the 866851ac deleteAccount's, field for
        field, each computed from the members map that phone last saw. */
  const famSeed = (members, memberInfo) => seed(async (db) => {
    await env.clearFirestore();
    await db.doc('households/HD').set({ ownerId: 'O', members, memberInfo, app: cleanApp() });
  });
  const pair = () => famSeed({ O: 'owner', H: 'caregiver' }, { O: { name: 'Olive', role: 'owner', relationship: 'Mama Bear' }, H: { name: 'Hal', role: 'caregiver', relationship: 'Papa Bear' } });
  const coOwners = () => famSeed({ O: 'owner', H: 'owner' }, { O: { name: 'Olive', role: 'owner' }, H: { name: 'Hal', role: 'owner' } });
  const tomb = (rel) => ({ name: '', relationship: rel || '', avatar: null });
  // The owner leaves and hands over (she saw H in the family).
  const ownerHandsOver = (db, promote) => db.doc('households/HD').update(Object.assign({ 'members.O': del(), 'memberInfo.O': del(),
    'formerMemberInfo.O': tomb('Mama Bear'), ownerId: 'H' }, promote ? { 'members.H': 'owner' } : {}));
  // A member leaves, others staying (she saw someone else in the family).
  const leaves = (db, uid, extra) => db.doc('households/HD').update(Object.assign({ ['members.' + uid]: del(), ['memberInfo.' + uid]: del(),
    ['formerMemberInfo.' + uid]: tomb() }, extra || {}));
  // The last one out (she saw nobody else).
  const lastOut = (db, uid, at) => db.doc('households/HD').update({ ['members.' + uid]: del(), ['memberInfo.' + uid]: del(),
    ['formerMemberInfo.' + uid]: tomb(), deleteAfter: at || (Date.now() + 30 * DAY), deletionRequestedBy: uid });
  const state = async () => { const d = (await readAdmin('households/HD')).data(); return { members: d.members, ownerId: d.ownerId, deleteAfter: d.deleteAfter || null }; };
  const H = as('H');

  console.log('\n3. two deletions at once, forced interleaving (the second, stale write must FAIL)');
  await checkOn(pair, 'A. the heir leaves first; then the owner\'s stale write promotes the departed heir', async () => {
    await assertSucceeds(leaves(H, 'H'));
    const err = await ownerHandsOver(O, true).then(() => null, (e) => e);
    if (!err) throw new Error('accepted: the family is now ' + JSON.stringify(await state()) + ' (a deleted account is its owner, and it is never purged)');
  });
  await check('A. and the owner, asked again with what is really there, goes as the last one out', (async () => {
    await assertSucceeds(lastOut(O, 'O'));
    const s = await state();
    if (Object.keys(s.members).length || !s.deleteAfter) throw new Error(JSON.stringify(s));
  })());
  await checkOn(pair, 'B. the owner hands over first; then the heir\'s stale write leaves nobody and schedules nothing', async () => {
    await assertSucceeds(ownerHandsOver(O, true));
    const err = await leaves(H, 'H').then(() => null, (e) => e);
    if (!err) throw new Error('accepted: the family is now ' + JSON.stringify(await state()) + ' (nobody in it, never purged)');
  });
  await check('B. and the heir, asked again, goes as the last one out (she is the owner now)', (async () => {
    await assertSucceeds(lastOut(H, 'H'));
    const s = await state();
    if (Object.keys(s.members).length || !s.deleteAfter) throw new Error(JSON.stringify(s));
  })());
  await checkOn(coOwners, 'C. two co-owners: one hands over to the other, who has just left; nobody left, nothing scheduled', async () => {
    await assertSucceeds(leaves(H, 'H', { ownerId: 'O' }));
    const err = await ownerHandsOver(O, false).then(() => null, (e) => e);
    if (!err) throw new Error('accepted: the family is now ' + JSON.stringify(await state()));
  });

  console.log('\n3b. ordinary departures still land (must SUCCEED)');
  await checkOn(pair, 'the owner hands over to a caregiver who is still here', () => assertSucceeds(ownerHandsOver(O, true)));
  await checkOn(pair, 'a caregiver leaves, the owner stays', () => assertSucceeds(leaves(H, 'H')));
  await checkOn(() => famSeed({ O: 'owner' }, { O: { name: 'Olive', role: 'owner' } }), 'the only one in the family goes, scheduling its deletion', () => assertSucceeds(lastOut(O, 'O')));
  await checkOn(() => famSeed({ H: 'caregiver' }, { H: { name: 'Hal', role: 'caregiver' } }), 'a caregiver who is the only one left goes, scheduling its deletion', () => assertSucceeds(lastOut(H, 'H')));
  await checkOn(pair, 'the owner promotes a caregiver who is in the family', () => assertSucceeds(O.doc('households/HD').update({ 'members.H': 'owner' })));
  await checkOn(pair, 'the owner removes a caregiver', () => assertSucceeds(O.doc('households/HD').update({ 'members.H': del(), 'memberInfo.H': del(), 'formerMemberInfo.H': tomb() })));

  console.log('\n3c. attacks (must FAIL)');
  await checkOn(pair, 'the owner writes a stranger into members', () => assertFails(O.doc('households/HD').update({ 'members.S': 'caregiver' })));
  await checkOn(pair, 'the owner writes a stranger in as owner', () => assertFails(O.doc('households/HD').update({ 'members.S': 'owner', ownerId: 'S' })));
  await checkOn(pair, 'the owner empties the family without scheduling its deletion', () => assertFails(O.doc('households/HD').update({ 'members.O': del(), 'members.H': del(), 'formerMemberInfo.O': tomb() })));
  await checkOn(pair, 'a caregiver leaves and flags the family while the owner is still in it', () => assertFails(leaves(H, 'H', { deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'H' })));
  await checkOn(() => famSeed({ H: 'caregiver' }, { H: { name: 'Hal', role: 'caregiver' } }), 'the last caregiver schedules the purge for tomorrow', () => assertFails(lastOut(H, 'H', Date.now() + DAY)));
  await checkOn(() => famSeed({ H: 'caregiver' }, { H: { name: 'Hal', role: 'caregiver' } }), 'the last caregiver names someone else as asking for it', () => assertFails(H.doc('households/HD').update({ 'members.H': del(), 'memberInfo.H': del(),
    'formerMemberInfo.H': tomb(), deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'O' })));
  await checkOn(() => famSeed({ H: 'caregiver' }, { H: { name: 'Hal', role: 'caregiver' } }), 'the last caregiver leaves with no deletion scheduled', () => assertFails(leaves(H, 'H')));
  await checkOn(() => famSeed({ H: 'caregiver' }, { H: { name: 'Hal', role: 'caregiver' } }), 'the last caregiver rewrites the app blob on the way out', () => assertFails(H.doc('households/HD').update({ 'members.H': del(), 'memberInfo.H': del(),
    'formerMemberInfo.H': tomb(), deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'H', app: Object.assign(cleanApp(), { babies: [{ id: 'x' }] }) })));

  await env.cleanup();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'LINKS-LEAVE-RULES: FAIL' : 'LINKS-LEAVE-RULES: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
