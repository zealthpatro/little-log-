'use strict';
/* Who may change a household document, proved against the emulator. 2026-11-12 security audit,
 * findings rules-deleteafter-purge, identity-caregiver-deleteafter, missed-1, rules-ex-member-rejoin,
 * identity-rejoin-after-removal, client-m2, identity-invisible-member, rules-household-mirrors.
 *
 * What was wrong, in one line each:
 *   - any caregiver, and any joiner in the join write itself, could set deleteAfter, and the purge
 *     cron then erased the whole family within 15 minutes, with no backup to restore from
 *   - a join grant was never used up: a removed member could write themselves back in with the
 *     token from their old link, or with an invite that was never deleted
 *   - a member could delete their own circle entry and stay in the family where nobody could see
 *     them, or relabel their entry as owner
 *   - caregivers could rewrite or delete the pending invite and link lists the owner relies on
 *
 * Every write the real client makes is here as a MUST SUCCEED case, in the exact shape
 * app/store-firebase.js and app/cubby-extras.js send it. Every attack is a MUST FAIL case.
 *
 * Run (as tools/gates.js does, from test/):
 *   npx firebase-tools emulators:exec --only firestore --project demo-cubby "node household-guard.test.js"
 *
 * Deploy window check. The client ships before the rules are published, so the NEW client has to
 * work under the OLD rules. `--old-rules=<file>` runs only the new-client shapes against that file
 * and checks each lands the way the client expects (the link batch is refused there, which is what
 * makes the client fall back to the two-step join):
 *   git show 1a6df125:firestore.rules > /tmp/old.rules
 *   npx firebase-tools emulators:exec --only firestore --project demo-cubby \
 *     "node household-guard.test.js --old-rules=/tmp/old.rules"
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app').default || require('firebase/compat/app');
require('firebase/compat/firestore');

const OLD_ARG = process.argv.find((a) => a.startsWith('--old-rules='));
const RULES_PATH = OLD_ARG ? OLD_ARG.slice('--old-rules='.length) : path.join(__dirname, '..', 'firestore.rules');
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

/* Each attack runs on freshly seeded data. Otherwise one attack that wrongly SUCCEEDS (say, the
   owner leaving with deleteAfter = 1) changes the state the next case runs against, and that case
   then "fails" for the wrong reason, which is a pass that proves nothing. */
async function checkOn(reseed, name, fn) { await reseed(); return check(name, fn()); }

// The app blob a real client writes (appBlobFromState in app/store-firebase.js).
const cleanApp = () => ({ babies: [], settings: {}, milestones: [], meds: [], vaccines: {}, illnesses: [],
  photos: [], handoff: null, den: null, consents: [], guardians: null, timers: {} });
// memberUpdate() in app/store-firebase.js, field for field.
function memberUpdate(uid, role, extra) {
  const u = {};
  u['members.' + uid] = role;
  u['memberInfo.' + uid] = Object.assign({ name: 'Joiner', photoURL: '', role, relationship: 'Auntie Bear', joinedAt: ts() }, extra || {});
  return u;
}
// The email join as the new client sends it: the join, the invitee's own pending row cleared, and
// the invite deleted, in one batch (joinByEmailInvite in app/store-firebase.js).
function emailJoinBatch(db, hid, uid, email, role, mutate) {
  const upd = memberUpdate(uid, role || 'caregiver');
  const extra = (mutate && mutate(upd)) || [];
  const args = [new FP('pendingInvites', email), del()].concat(extra);
  Object.keys(upd).forEach((k) => args.push(k, upd[k]));
  const b = db.batch();
  b.update(db.doc('households/' + hid), ...args);
  b.delete(db.doc('invites/' + email));
  return b.commit();
}
// The link join as the new client sends it: claim, consume and join in one batch.
function linkJoinBatch(db, hid, uid, token, role, mutate, linkPatch) {
  const upd = Object.assign({ joinToken: token }, memberUpdate(uid, role || 'caregiver'));
  upd['pendingLinks.' + token] = del();
  const args = (mutate && mutate(upd)) || [];
  Object.keys(upd).forEach((k) => args.push(k, upd[k]));
  const b = db.batch();
  b.update(db.doc('inviteLinks/' + token), linkPatch || { usedBy: uid, consumed: true });
  b.update(db.doc('households/' + hid), ...args);
  return b.commit();
}

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-cubby', firestore: { rules: RULES } });
  await env.clearFirestore();
  const as = (uid, email) => env.authenticatedContext(uid, { email: email || (uid.toLowerCase() + '@x.com') }).firestore();
  const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
  const readAdmin = async (p) => { let d; await seed(async (db) => { d = (await db.doc(p).get()); }); return d; };

  const household = (extra) => Object.assign({
    ownerId: 'O', members: { O: 'owner', C: 'caregiver' },
    memberInfo: { O: { name: 'Olive', role: 'owner', relationship: 'Mama Bear' }, C: { name: 'Carl', role: 'caregiver', relationship: 'Papa Bear' } },
    formerMemberInfo: { X: { name: 'Ex', relationship: 'Nanny', avatar: null } },
    pendingInvites: { 'pend@x.com': { name: 'Pen', relationship: 'Granny', role: 'caregiver', at: 1 } },
    pendingLinks: { tokPend: { at: 1, expiresAt: Date.now() + DAY, sentTo: '' } },
    joinToken: 'tokOld',
    app: cleanApp()
  }, extra || {});

  /* ------------------------------------------------------------------------------------------- */
  if (OLD_ARG) {
    console.log('\nNEW client shapes under the OLD rules (' + RULES_PATH + ')');
    await seed(async (db) => {
      await db.doc('households/HE').set(household({ members: { O: 'owner' }, memberInfo: { O: { name: 'Olive', role: 'owner' } } }));
      await db.doc('invites/nina@x.com').set({ householdId: 'HE', role: 'caregiver', invitedBy: 'O', invitedByName: 'Olive' });
      await db.doc('invites/paul@x.com').set({ householdId: 'HE', role: 'caregiver', invitedBy: 'O', invitedByName: 'Olive' });
      await db.doc('households/HK').set(household({ members: { O: 'owner' }, memberInfo: { O: { name: 'Olive', role: 'owner' } },
        pendingLinks: { tokA: { at: 1 } } }));
      await db.doc('inviteLinks/tokA').set({ householdId: 'HK', role: 'caregiver', usedBy: null, expiresAt: inHours(24), invitedBy: 'O' });
      await db.doc('households/HS').set({ ownerId: 'S', members: { S: 'owner' }, memberInfo: { S: { name: 'Solo', role: 'owner' } }, app: cleanApp() });
      await db.doc('households/H').set(household());
    });
    await check('email join batch lands (so a newcomer who says yes is joined)',
      assertSucceeds(emailJoinBatch(as('N', 'nina@x.com'), 'HE', 'N', 'nina@x.com')));
    await check('link join batch is REFUSED here, which is the client\'s cue to fall back',
      assertFails(linkJoinBatch(as('J', 'j@x.com'), 'HK', 'J', 'tokA')));
    await check('fallback step 1: claim AND consume the link',
      assertSucceeds(as('J', 'j@x.com').doc('inviteLinks/tokA').update({ usedBy: 'J', consumed: true })));
    await check('fallback step 2: the single join write, clearing the pending row',
      assertSucceeds(as('J', 'j@x.com').doc('households/HK').update(Object.assign({ joinToken: 'tokA', 'pendingLinks.tokA': del() }, memberUpdate('J', 'caregiver')))));
    await check('a newcomer who declines can delete the invite addressed to her',
      assertSucceeds(as('P', 'paul@x.com').doc('invites/paul@x.com').delete()));
    await check('caregiver persist still lands',
      assertSucceeds(as('C').doc('households/H').update({ 'app.babies': [], updatedAt: ts() })));
    await check('the sole owner\'s deletion flag (now + 30 days) still lands',
      assertSucceeds(as('S').doc('households/HS').update({ 'members.S': del(), 'memberInfo.S': del(),
        'formerMemberInfo.S': { name: '', relationship: '', avatar: null }, deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'S' })));
    await check('a new family is still created (the real client shape)',
      assertSucceeds(as('NEWU', 'newu@x.com').doc('households/HNEW').set({ ownerId: 'NEWU', members: { NEWU: 'owner' },
        memberInfo: { NEWU: { name: 'Newt', photoURL: '', role: 'owner', relationship: '' } }, app: cleanApp(), createdAt: ts() })));
    await env.cleanup();
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    console.log(fail ? 'HOUSEHOLD-GUARD (old rules): FAIL' : 'HOUSEHOLD-GUARD (old rules): PASS');
    process.exit(fail ? 1 : 0);
  }

  /* ---------------------------------------------------------------------------------------------
     1. A caregiver's own writes. The only legitimate ones: the app blob, updatedAt, and their own
        memberInfo fields (name, relationship, setupDone, avatar). */
  await seed((db) => db.doc('households/H').set(household()));
  const C = as('C');
  console.log('\n1. caregiver: what they really write (must SUCCEED)');
  await check('persist: app.<key> field paths + updatedAt',
    assertSucceeds(C.doc('households/H').update({ 'app.babies': [{ id: 'b1', name: 'Bo' }], 'app.meds': [], updatedAt: ts() })));
  await check('persist from an older cached build: whole app + updatedAt',
    assertSucceeds(C.doc('households/H').update({ app: cleanApp(), updatedAt: ts() })));
  await check('first-run identity: setupDone, name, relationship',
    assertSucceeds(C.doc('households/H').update({ 'memberInfo.C.setupDone': true, 'memberInfo.C.name': 'Carl', 'memberInfo.C.relationship': 'Papa Bear' })));
  await check('profile: relationship + name',
    assertSucceeds(C.doc('households/H').update({ 'memberInfo.C.relationship': 'Dad', 'memberInfo.C.name': 'Carl B' })));
  await check('bear avatar claim',
    assertSucceeds(C.doc('households/H').update({ 'memberInfo.C.avatar': { art: 'cub-3', fur: '#c8a27a', acc: 'none', auto: true } })));

  const hSeed = () => seed((db) => db.doc('households/H').set(household()));
  console.log('\n1b. caregiver: attacks (must FAIL)');
  await checkOn(hSeed, 'sets deleteAfter (the 15-minute wipe)', () => assertFails(C.doc('households/H').update({ deleteAfter: 1 })));
  await checkOn(hSeed, 'sets deleteAfter a month out', () => assertFails(C.doc('households/H').update({ deleteAfter: Date.now() + 31 * DAY })));
  await checkOn(hSeed, 'sets deletionRequestedBy', () => assertFails(C.doc('households/H').update({ deletionRequestedBy: 'C' })));
  await checkOn(hSeed, 'hides deleteAfter inside a normal save', () => assertFails(C.doc('households/H').update({ 'app.babies': [], updatedAt: ts(), deleteAfter: 1 })));
  await checkOn(hSeed, 'deletes their own circle entry and stays (invisible member)', () => assertFails(C.doc('households/H').update({ 'memberInfo.C': del() })));
  await checkOn(hSeed, 'relabels their own entry as owner', () => assertFails(C.doc('households/H').update({ 'memberInfo.C.role': 'owner' })));
  await checkOn(hSeed, 'replaces their own entry and drops the role', () => assertFails(C.doc('households/H').update({ 'memberInfo.C': { name: 'Carl' } })));
  await checkOn(hSeed, 'deletes a pending invite row', () => assertFails(C.doc('households/H').update(new FP('pendingInvites', 'pend@x.com'), del())));
  await checkOn(hSeed, 'adds a pending invite row', () => assertFails(C.doc('households/H').update(new FP('pendingInvites', 'evil@x.com'), { name: 'x', at: 1 })));
  await checkOn(hSeed, 'deletes a pending link row', () => assertFails(C.doc('households/H').update({ 'pendingLinks.tokPend': del() })));
  await checkOn(hSeed, 'adds a pending link row', () => assertFails(C.doc('households/H').update({ 'pendingLinks.tokEvil': { at: 1 } })));
  await checkOn(hSeed, 'rewrites a former member tombstone', () => assertFails(C.doc('households/H').update({ 'formerMemberInfo.X.name': 'someone else' })));
  await checkOn(hSeed, 'rewrites joinToken', () => assertFails(C.doc('households/H').update({ joinToken: 'tokEvil' })));
  await checkOn(hSeed, 'adds a top-level key nobody writes', () => assertFails(C.doc('households/H').update({ foo: 1 })));

  /* A member already in the family going through a JOIN branch. Nobody legitimately rejoins a
     household they are in (readInviteLink and the existing-user prompt both skip your own
     household), so each of these is a caregiver borrowing a newcomer's door: to spend the owner's
     link for someone else, to replace her own circle entry, or to come out of it as owner. */
  const joinAsMemberSeed = (inviteRole) => seed(async (db) => {
    await db.doc('households/H').set(household({ pendingInvites: { 'pend@x.com': { name: 'Pen', role: 'caregiver', at: 1 }, 'c@x.com': { name: 'Carl', role: inviteRole || 'owner', at: 1 } } }));
    await db.doc('inviteLinks/tokPend').set({ householdId: 'H', role: 'caregiver', usedBy: null, expiresAt: inHours(20), invitedBy: 'O' });
    await db.doc('inviteLinks/tokOwner').set({ householdId: 'H', role: 'owner', usedBy: null, expiresAt: inHours(20), invitedBy: 'O' });
    await db.doc('invites/c@x.com').set({ householdId: 'H', role: inviteRole || 'owner', invitedBy: 'O', invitedByName: 'Olive' });
  });
  const keepPending = (u) => { delete u['pendingLinks.tokPend']; };
  await checkOn(() => joinAsMemberSeed(), 'link-join branch: spends the owner\'s live link and deletes its pending row',
    () => assertFails(linkJoinBatch(C, 'H', 'C', 'tokPend', 'caregiver')));
  await checkOn(() => joinAsMemberSeed(), 'link-join branch: replaces her own circle entry wholesale',
    () => assertFails(linkJoinBatch(C, 'H', 'C', 'tokPend', 'caregiver', (u) => { keepPending(u); u['memberInfo.C'] = { role: 'caregiver', name: '' }; })));
  await checkOn(() => joinAsMemberSeed(), 'link-join branch: promotes herself to owner with an owner-role link',
    () => assertFails(linkJoinBatch(C, 'H', 'C', 'tokOwner', 'owner')));
  await checkOn(() => joinAsMemberSeed('owner'), 'email-join branch: promotes herself to owner with a co-owner invite',
    () => assertFails(emailJoinBatch(C, 'H', 'C', 'c@x.com', 'owner')));
  await checkOn(() => joinAsMemberSeed('caregiver'), 'email-join branch: replaces her own circle entry wholesale',
    () => assertFails(emailJoinBatch(C, 'H', 'C', 'c@x.com', 'caregiver', (u) => { u['memberInfo.C'] = { role: 'caregiver', name: '' }; })));
  await checkOn(() => joinAsMemberSeed('caregiver'), 'email-join branch: clears a row from the owner\'s pending list, staying caregiver',
    () => assertFails(emailJoinBatch(C, 'H', 'C', 'c@x.com', 'caregiver')));

  /* ---------------------------------------------------------------------------------------------
     2. The owner. Unchanged except deletion: only the last one out may flag the household, naming
        themselves, at least 29 days out (the client writes 30; one day of clock skew allowed). */
  console.log('\n2. owner: what they really write (must SUCCEED)');
  const O = as('O');
  await check('app blob save', assertSucceeds(O.doc('households/H').update({ 'app.meds': [], updatedAt: ts() })));
  await check('renames another member', assertSucceeds(O.doc('households/H').update({ 'memberInfo.C.relationship': 'Caregiver' })));
  await check('mirrors a new email invite', assertSucceeds(O.doc('households/H').update(new FP('pendingInvites', 'new@x.com'), { name: 'N', relationship: 'Aunt', role: 'caregiver', at: Date.now() })));
  await check('cancels an email invite row', assertSucceeds(O.doc('households/H').update(new FP('pendingInvites', 'new@x.com'), del())));
  await check('mirrors a new link', assertSucceeds(O.doc('households/H').update(new FP('pendingLinks', 'tokNew'), { at: Date.now(), expiresAt: Date.now() + DAY, sentTo: '' })));
  await check('records who the link was emailed to', assertSucceeds(O.doc('households/H').update(new FP('pendingLinks', 'tokNew', 'sentTo'), 'aunt@x.com')));
  await check('cancels a link row', assertSucceeds(O.doc('households/H').update(new FP('pendingLinks', 'tokNew'), del())));
  await check('strips legacy emails out of memberInfo', assertSucceeds(O.doc('households/H').update({ 'memberInfo.O.email': del(), 'memberInfo.C.email': del() })));
  await check('removes a member, leaving a tombstone', assertSucceeds(O.doc('households/H').update({ 'members.C': del(), 'memberInfo.C': del(), 'formerMemberInfo.C': { name: 'Carl', relationship: 'Dad', avatar: null } })));

  console.log('\n2b. owner: deletion flag (attacks must FAIL)');
  const h2Seed = () => seed((db) => db.doc('households/H2').set(household()));
  await checkOn(h2Seed, 'owner flags a household that still has another member', () => assertFails(O.doc('households/H2').update({ deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'O' })));
  await checkOn(h2Seed, 'owner leaves (heir promoted) and flags it anyway', () => assertFails(O.doc('households/H2').update({ 'members.O': del(), 'memberInfo.O': del(), 'members.C': 'owner', ownerId: 'C', deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'O' })));
  await checkOn(h2Seed, 'owner sets only deletionRequestedBy', () => assertFails(O.doc('households/H2').update({ deletionRequestedBy: 'O' })));
  const soloSeed = () => seed((db) => db.doc('households/HS').set({ ownerId: 'S', members: { S: 'owner' }, memberInfo: { S: { name: 'Solo', role: 'owner' } }, app: cleanApp() }));
  const S = as('S');
  const leaveSolo = (extra) => S.doc('households/HS').update(Object.assign({ 'members.S': del(), 'memberInfo.S': del(), 'formerMemberInfo.S': { name: '', relationship: '', avatar: null } }, extra));
  await checkOn(soloSeed, 'last one out, deleteAfter = 1 (purge on the next tick)', () => assertFails(leaveSolo({ deleteAfter: 1, deletionRequestedBy: 'S' })));
  await checkOn(soloSeed, 'last one out, deleteAfter tomorrow', () => assertFails(leaveSolo({ deleteAfter: Date.now() + DAY, deletionRequestedBy: 'S' })));
  await checkOn(soloSeed, 'last one out, deleteAfter as a string', () => assertFails(leaveSolo({ deleteAfter: String(Date.now() + 30 * DAY), deletionRequestedBy: 'S' })));
  await checkOn(soloSeed, 'last one out, naming someone else as the requester', () => assertFails(leaveSolo({ deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'C' })));
  await checkOn(() => seed((db) => db.doc('households/H2').set(household({ deleteAfter: 1, deletionRequestedBy: 'C' }))),
    'a caregiver clears a deletion flag (only an owner may)', () => assertFails(C.doc('households/H2').update({ deleteAfter: del(), deletionRequestedBy: del() })));
  console.log('\n2c. owner: deletion flag (legit, must SUCCEED)');
  await seed((db) => db.doc('households/H2').set(household({ deleteAfter: 1, deletionRequestedBy: 'C' })));
  await check('the owner clears a bogus deletion flag (cancelling is always safe)', assertSucceeds(O.doc('households/H2').update({ deleteAfter: del(), deletionRequestedBy: del() })));
  await soloSeed();
  await check('last one out, the real client shape (now + 30 days, self)', assertSucceeds(leaveSolo({ deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'S' })));
  await seed((db) => db.doc('households/H3').set(household()));
  await check('owner leaves with an heir and no flag', assertSucceeds(O.doc('households/H3').update({ 'members.O': del(), 'memberInfo.O': del(), 'members.C': 'owner', ownerId: 'C', 'formerMemberInfo.O': { name: '', relationship: 'Mama Bear', avatar: null } })));
  await seed((db) => db.doc('households/H4').set(household()));
  await check('caregiver deletes their account (departingSelf)', assertSucceeds(C.doc('households/H4').update({ 'members.C': del(), 'memberInfo.C': del(), 'formerMemberInfo.C': { name: '', relationship: 'Papa Bear', avatar: null } })));

  /* ---------------------------------------------------------------------------------------------
     3. Joining by email. The invite is deleted in the same batch, so the grant is spent the moment
        it is used. The joiner may also clear their own pending row, and nothing else. */
  const emailSeed = (extra) => seed(async (db) => {
    await db.doc('households/HE').set(household(Object.assign({ members: { O: 'owner' }, memberInfo: { O: { name: 'Olive', role: 'owner' } },
      pendingInvites: { 'nina@x.com': { name: 'Nina', role: 'caregiver', at: 1 }, 'other@x.com': { name: 'Oth', role: 'caregiver', at: 1 } } }, extra || {})));
    await db.doc('invites/nina@x.com').set({ householdId: 'HE', role: 'caregiver', invitedBy: 'O', invitedByName: 'Olive' });
    await db.doc('invites/co@x.com').set({ householdId: 'HE', role: 'owner', invitedBy: 'O', invitedByName: 'Olive' });
  });
  const N = as('N', 'nina@x.com');
  console.log('\n3. email join (legit, must SUCCEED)');
  await emailSeed();
  await check('newcomer says yes: join + own pending row + invite deleted, one batch', assertSucceeds(emailJoinBatch(N, 'HE', 'N', 'nina@x.com')));
  await check('and the invite is gone afterwards', (async () => { if ((await readAdmin('invites/nina@x.com')).exists) throw new Error('invite survived the join'); })());
  await check('and her email is gone from the pending list', (async () => { const d = (await readAdmin('households/HE')).data(); if ('nina@x.com' in (d.pendingInvites || {})) throw new Error('row survived'); if (!('other@x.com' in d.pendingInvites)) throw new Error('someone else\'s row went too'); })());
  await check('a co-owner invite joins as owner', assertSucceeds(emailJoinBatch(as('CO', 'co@x.com'), 'HE', 'CO', 'co@x.com', 'owner')));
  console.log('\n3b. email join (attacks must FAIL)');
  await checkOn(() => emailSeed(), 'she joins, the owner removes her, she tries to rejoin', async () => {
    await assertSucceeds(emailJoinBatch(N, 'HE', 'N', 'nina@x.com'));
    await assertSucceeds(O.doc('households/HE').update({ 'members.N': del(), 'memberInfo.N': del(), 'formerMemberInfo.N': { name: 'Nina', relationship: '', avatar: null } }));
    await assertFails(N.doc('households/HE').update(memberUpdate('N', 'caregiver')));
  });
  await checkOn(() => emailSeed(), 'the old single write that leaves the invite behind', () => assertFails(N.doc('households/HE').update(memberUpdate('N', 'caregiver'))));
  await checkOn(() => emailSeed(), 'join batch that also sets deleteAfter', () => assertFails(emailJoinBatch(N, 'HE', 'N', 'nina@x.com', null, (u) => { u.deleteAfter = 1; })));
  await checkOn(() => emailSeed(), 'join batch that also sets deletionRequestedBy', () => assertFails(emailJoinBatch(N, 'HE', 'N', 'nina@x.com', null, (u) => { u.deletionRequestedBy = 'N'; })));
  await checkOn(() => emailSeed(), 'join with no circle entry (joins invisibly)', () => assertFails(emailJoinBatch(N, 'HE', 'N', 'nina@x.com', null, (u) => { delete u['memberInfo.N']; })));
  await checkOn(() => emailSeed(), 'join whose circle entry says owner', () => assertFails(emailJoinBatch(N, 'HE', 'N', 'nina@x.com', null, (u) => { u['memberInfo.N'].role = 'owner'; })));
  await checkOn(() => emailSeed(), 'join that clears someone else\'s pending row', () => assertFails(emailJoinBatch(N, 'HE', 'N', 'nina@x.com', null, () => [new FP('pendingInvites', 'other@x.com'), del()])));
  await checkOn(() => emailSeed(), 'join that edits the link list', () => assertFails(emailJoinBatch(N, 'HE', 'N', 'nina@x.com', null, (u) => { u['pendingLinks.tokPend'] = del(); })));
  await checkOn(() => emailSeed(), 'join that also rewrites the app blob', () => assertFails(emailJoinBatch(N, 'HE', 'N', 'nina@x.com', null, (u) => { u.app = Object.assign(cleanApp(), { babies: [{ id: 'planted' }] }); })));
  const flaggedEmailSeed = () => emailSeed({ deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'O', members: {}, memberInfo: {} });
  await checkOn(flaggedEmailSeed, 'join a household already flagged for deletion', () => assertFails(emailJoinBatch(N, 'HE', 'N', 'nina@x.com')));

  /* ---------------------------------------------------------------------------------------------
     4. Joining by link. Claim, consume and join in one batch: the household rule requires the
        link to go from not-consumed to consumed in this very write, so a link can admit exactly one
        person exactly once, and a removed member's old token is dead. */
  const linkSeed = (extra) => seed(async (db) => {
    await db.doc('households/HK').set(household(Object.assign({ members: { O: 'owner' }, memberInfo: { O: { name: 'Olive', role: 'owner' } },
      pendingLinks: { tokA: { at: 1 }, tokB: { at: 1 } } }, extra || {})));
    await db.doc('inviteLinks/tokA').set({ householdId: 'HK', role: 'caregiver', usedBy: null, expiresAt: inHours(24), invitedBy: 'O' });
    await db.doc('inviteLinks/tokB').set({ householdId: 'HK', role: 'caregiver', usedBy: null, expiresAt: inHours(24), invitedBy: 'O' });
    await db.doc('inviteLinks/tokExp').set({ householdId: 'HK', role: 'caregiver', usedBy: null, expiresAt: inHours(-1), invitedBy: 'O' });
    // Claimed by an older build, before `consumed` existed: the shape every past link join left.
    await db.doc('inviteLinks/tokLegacy').set({ householdId: 'HK', role: 'caregiver', usedBy: 'L', expiresAt: inHours(23), invitedBy: 'O' });
  });
  const J = as('J', 'j@x.com');
  console.log('\n4. link join (legit, must SUCCEED)');
  await linkSeed();
  await check('newcomer via link: claim + consume + join + own pending row, one batch', assertSucceeds(linkJoinBatch(J, 'HK', 'J', 'tokA')));
  await check('and the link is consumed', (async () => { const d = (await readAdmin('inviteLinks/tokA')).data(); if (d.consumed !== true || d.usedBy !== 'J') throw new Error(JSON.stringify(d)); })());
  await check('and only that pending row went', (async () => { const d = (await readAdmin('households/HK')).data(); if ('tokA' in d.pendingLinks || !('tokB' in d.pendingLinks)) throw new Error(JSON.stringify(d.pendingLinks)); })());
  await check('someone who already has a Cubby joins by link, same shape', assertSucceeds(linkJoinBatch(as('E', 'e@x.com'), 'HK', 'E', 'tokB')));
  console.log('\n4b. link join (attacks must FAIL)');
  // J joined through tokA, then the owner removed J: the state every removed link joiner is in.
  const joinedRemovedSeed = async () => {
    await linkSeed({ joinToken: 'tokA', formerMemberInfo: { J: { name: 'J', relationship: '', avatar: null } } });
    await seed((db) => db.doc('inviteLinks/tokA').update({ usedBy: 'J', consumed: true }));
  };
  await checkOn(joinedRemovedSeed, 'J, removed, rejoins with the consumed token (single write)',
    () => assertFails(J.doc('households/HK').update(Object.assign({ joinToken: 'tokA' }, memberUpdate('J', 'caregiver')))));
  await checkOn(joinedRemovedSeed, 'J, removed, rejoins with the consumed token (batch)', () => assertFails(linkJoinBatch(J, 'HK', 'J', 'tokA', null, null, { usedBy: 'J', consumed: true })));
  await checkOn(() => linkSeed(), 'a removed member rejoins with a LEGACY claimed link (single write)', () => assertFails(as('L', 'l@x.com').doc('households/HK').update(Object.assign({ joinToken: 'tokLegacy' }, memberUpdate('L', 'caregiver')))));
  await checkOn(() => linkSeed(), 'a removed member rejoins with a LEGACY claimed link (batch)', () => assertFails(linkJoinBatch(as('L', 'l@x.com'), 'HK', 'L', 'tokLegacy')));
  await checkOn(() => linkSeed(), 'the old two-step: claim, then a separate join write', async () => {
    await assertSucceeds(J.doc('inviteLinks/tokB').update({ usedBy: 'J' }));
    await assertFails(J.doc('households/HK').update(Object.assign({ joinToken: 'tokB' }, memberUpdate('J', 'caregiver'))));
  });
  // The audit's own attack: a link invitee flags the household in the join write itself.
  await checkOn(() => linkSeed(), 'a link joiner sets deleteAfter in the join write', async () => {
    await assertSucceeds(J.doc('inviteLinks/tokB').update({ usedBy: 'J' }));
    await assertFails(J.doc('households/HK').update(Object.assign({ joinToken: 'tokB', deleteAfter: 1 }, memberUpdate('J', 'caregiver'))));
  });
  await checkOn(() => linkSeed(), 'join batch with an expired link', () => assertFails(linkJoinBatch(J, 'HK', 'J', 'tokExp')));
  await checkOn(() => linkSeed(), 'join batch that sets deleteAfter', () => assertFails(linkJoinBatch(J, 'HK', 'J', 'tokA', null, (u) => { u.deleteAfter = 1; })));
  await checkOn(() => linkSeed(), 'join batch that sets deletionRequestedBy', () => assertFails(linkJoinBatch(J, 'HK', 'J', 'tokA', null, (u) => { u.deletionRequestedBy = 'J'; })));
  await checkOn(() => linkSeed(), 'join batch with no circle entry (joins invisibly)', () => assertFails(linkJoinBatch(J, 'HK', 'J', 'tokA', null, (u) => { delete u['memberInfo.J']; })));
  await checkOn(() => linkSeed(), 'join batch whose circle entry says owner', () => assertFails(linkJoinBatch(J, 'HK', 'J', 'tokA', null, (u) => { u['memberInfo.J'].role = 'owner'; })));
  await checkOn(() => linkSeed(), 'join batch that deletes ANOTHER pending link row', () => assertFails(linkJoinBatch(J, 'HK', 'J', 'tokA', null, (u) => { u['pendingLinks.tokB'] = del(); })));
  await checkOn(() => linkSeed(), 'join batch that edits the email invite list', () => assertFails(linkJoinBatch(J, 'HK', 'J', 'tokA', null, () => [new FP('pendingInvites', 'pend@x.com'), del()])));
  await checkOn(() => linkSeed(), 'join batch that also rewrites the app blob', () => assertFails(linkJoinBatch(J, 'HK', 'J', 'tokA', null, (u) => { u.app = Object.assign(cleanApp(), { babies: [{ id: 'planted' }] }); })));
  await checkOn(() => linkSeed(), 'join batch that marks the link consumed but claims it for someone else', () => assertFails(linkJoinBatch(J, 'HK', 'J', 'tokA', null, null, { usedBy: 'Z', consumed: true })));
  const flaggedLinkSeed = () => linkSeed({ deleteAfter: Date.now() + 30 * DAY, deletionRequestedBy: 'O', members: {}, memberInfo: {} });
  await checkOn(flaggedLinkSeed, 'join a household already flagged for deletion', () => assertFails(linkJoinBatch(J, 'HK', 'J', 'tokA')));

  /* ---------------------------------------------------------------------------------------------
     5. Creating a household. A new family is never born flagged: the flag is set only by the last
        one out (section 2). A household made with deleteAfter = 1 is not a wipe any more (the cron
        refuses a family with people in it), but over 50 of them would hold every slot of the cron's
        page and push real account deletions past the 30 days the privacy page promises. */
  console.log('\n5. household create');
  const NEW = as('NEWU', 'newu@x.com');
  // resolveHousehold's create in app/store-firebase.js, field for field.
  const realCreate = (extra) => Object.assign({ ownerId: 'NEWU', members: { NEWU: 'owner' },
    memberInfo: { NEWU: { name: 'Newt', photoURL: '', role: 'owner', relationship: '' } }, app: cleanApp(), createdAt: ts() }, extra || {});
  await check('a new family, the real client shape (must SUCCEED)', assertSucceeds(NEW.doc('households/HNEW').set(realCreate())));
  await check('create carrying deleteAfter = 1 (must FAIL)', assertFails(NEW.doc('households/HNEW2').set(realCreate({ deleteAfter: 1, deletionRequestedBy: 'NEWU' }))));
  await check('create carrying only deleteAfter, a month out (must FAIL)', assertFails(NEW.doc('households/HNEW3').set(realCreate({ deleteAfter: Date.now() + 30 * DAY }))));
  await check('create carrying only deletionRequestedBy (must FAIL)', assertFails(NEW.doc('households/HNEW4').set(realCreate({ deletionRequestedBy: 'NEWU' }))));

  await env.cleanup();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'HOUSEHOLD-GUARD: FAIL' : 'HOUSEHOLD-GUARD: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
