'use strict';
/* One invite per family per address, proved against the emulator. Lane C (D3), November 2026.
 *
 * What was wrong. invites/{email} was keyed only by the address, so the first owner to write it held
 * the slot: any other family's owner could take a person's invite slot first, and her real family
 * was told "Cubby couldn't make an invite for that address". Now each family writes its own invite at
 * invites/{email}/from/{householdId}:
 *   - the invitee (a PROVEN address, her own only) may list and read her invites and delete any of them
 *   - an owner may create, read, update and delete the one for her OWN household, and no other
 *   - the sender proof is the legacy one exactly (senderProven: fromEmail is her own verified address,
 *     and a name never travels without it)
 *   - the join checks the per-family doc, and every grant this address holds for THAT family (the
 *     per-family doc and a legacy doc pointing at the family) is spent by the join, whichever door
 * The legacy invites/{email} doc keeps working (read, join, decline, cancel) for the 866851ac client.
 * Round 2: the per-family door also needs her row on the owner's pendingInvites list, so the 866851ac
 * build's Cancel and Remove (which clear the row but cannot see this invite) close it too (section 6);
 * and a per-family invite is dated by the server on every write, so nobody can date one ahead to be
 * asked first (section 7).
 * Round 3: the per-family door joins only at the role her row states, so an invite an older build
 * withdrew and sent again at another role cannot come back at the role she withdrew (section 8).
 *
 * Every write the real client makes is a MUST SUCCEED case, in the shape app/store-firebase.js sends
 * it (createEmailInvite, joinByEmailInvite, declineOffer, cancelInvite). Every attack is MUST FAIL.
 *
 * Run (from test/):
 *   npx firebase-tools emulators:exec --only firestore --project demo-cubby "node invite-family-rules.test.js"
 *
 * Deploy window. The client ships before the rules, so the NEW client must still work under the
 * rules that are live when it lands. `--old-rules=<file>` runs only the new client's shapes against
 * that file and checks each one lands the way the client expects: every per-family call is REFUSED
 * there (the client's cue to fall back to the legacy path), and the legacy fallbacks all land.
 *   git show 866851ac:firestore.rules > /tmp/r365.rules   (and 1a6df125 for what is live today)
 *   npx firebase-tools emulators:exec --only firestore --project demo-cubby \
 *     "node invite-family-rules.test.js --old-rules=/tmp/r365.rules"
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

let pass = 0, fail = 0;
async function check(name, p) {
  try { await p; pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '   (' + ((e && e.message) || e).toString().split('\n')[0] + ')'); }
}
async function checkOn(reseed, name, fn) { await reseed(); return check(name, fn()); }

const cleanApp = () => ({ babies: [], settings: {}, milestones: [], meds: [], vaccines: {}, illnesses: [], photos: [] });
// memberUpdate() in app/store-firebase.js, field for field.
function memberUpdate(uid, role) {
  const u = {};
  u['members.' + uid] = role;
  u['memberInfo.' + uid] = { name: 'Nina', photoURL: '', role, relationship: 'Auntie', joinedAt: ts() };
  return u;
}
// The invite as createEmailInvite() writes it, at either path.
const invDoc = (hid, from, extra) => Object.assign({
  householdId: hid, role: 'caregiver', relationship: 'Auntie', name: 'Nina', invitedBy: from.uid,
  status: 'pending', createdAt: ts(), fromEmail: from.email, invitedByName: from.name,
}, extra || {});
// The shape an older build wrote: no sender address and no sender name.
const unsigned = (d) => { const c = Object.assign({}, d); delete c.fromEmail; delete c.invitedByName; return c; };
const famPath = (email, hid) => 'invites/' + email + '/from/' + hid;
/* joinByEmailInvite(): the join, her own pending row cleared, and every doc of that offer deleted, in
   one batch. `docs` is what the client read: 'family', 'legacy' or both. */
function joinBatch(db, hid, uid, email, docs, role, mutate) {
  const upd = memberUpdate(uid, role || 'caregiver');
  const extra = (mutate && mutate(upd)) || [];
  const args = [new FP('pendingInvites', email), del()].concat(extra);
  Object.keys(upd).forEach((k) => args.push(k, upd[k]));
  const b = db.batch();
  b.update(db.doc('households/' + hid), ...args);
  if (docs.includes('family')) b.delete(db.doc(famPath(email, hid)));
  if (docs.includes('legacy')) b.delete(db.doc('invites/' + email));
  return b.commit();
}

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-cubby', firestore: { rules: RULES } });
  await env.clearFirestore();
  const as = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
  const asUnverified = (uid, email) => env.authenticatedContext(uid, { email, email_verified: false }).firestore();
  const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
  const readAdmin = async (p) => { let d; await seed(async (db) => { d = await db.doc(p).get(); }); return d; };

  const OLIVE = { uid: 'O', email: 'olive@x.com', name: 'Olive' };   // family A's owner
  const BEA = { uid: 'B', email: 'bea@x.com', name: 'Bea' };         // family B's owner: the squatter
  const O = as('O', OLIVE.email), B = as('B', BEA.email);
  const C = as('C', 'carl@x.com');                                   // a caregiver in family A
  const N = as('N', 'nina@x.com');                                   // the person both families invite
  const S = as('S', 'sam@x.com');                                    // a stranger
  const hh = (owner, extra) => Object.assign({ ownerId: owner, members: { [owner]: 'owner' },
    memberInfo: { [owner]: { name: owner, role: 'owner' } }, pendingInvites: {}, app: cleanApp() }, extra || {});
  // Every case starts from an EMPTY database: an invite left over from the case before would change
  // which grants a join has to spend, and the case would pass or fail for the wrong reason.
  const base = () => env.clearFirestore().then(() => seed(async (db) => {
    await db.doc('households/A').set(hh('O', { members: { O: 'owner', C: 'caregiver' },
      memberInfo: { O: { name: 'Olive', role: 'owner' }, C: { name: 'Carl', role: 'caregiver' } },
      pendingInvites: { 'nina@x.com': { name: 'Nina', role: 'caregiver', at: 1 }, 'other@x.com': { name: 'Oth', role: 'caregiver', at: 1 } } }));
    await db.doc('households/B').set(hh('B', { pendingInvites: { 'nina@x.com': { name: 'Nina', role: 'caregiver', at: 1 } } }));
  }));

  /* ------------------------------------------------------------------------------------------- */
  if (OLD_ARG) {
    console.log('\nNEW client shapes under the rules live before this change (' + RULES_PATH + ')');
    const s0 = () => base();
    await checkOn(s0, 'the per-family invite is REFUSED here, which is the client\'s cue to write the legacy one',
      () => assertFails(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE))));
    await checkOn(s0, 'the legacy fallback lands (the shape the new client falls back to)',
      () => assertSucceeds(O.doc('invites/nina@x.com').set(invDoc('A', OLIVE))));
    await checkOn(s0, 'the invitee\'s list of per-family invites is refused (the client catches it and reads legacy only)',
      () => assertFails(N.collection('invites/nina@x.com/from').get()));
    await checkOn(s0, 'the owner\'s check of her own family\'s invite is refused (the client keeps today\'s row)',
      () => assertFails(O.doc(famPath('nina@x.com', 'A')).get()));
    await checkOn(s0, 'the owner\'s delete of a per-family doc is refused (cancel then relies on the legacy delete)',
      () => assertFails(O.doc(famPath('nina@x.com', 'A')).delete()));
    const sLegacy = () => base().then(() => seed((db) => db.doc('invites/nina@x.com').set(invDoc('A', OLIVE))));
    await checkOn(sLegacy, 'the invitee reads her legacy invite',
      () => assertSucceeds(N.doc('invites/nina@x.com').get()));
    await checkOn(sLegacy, 'she joins through it: the new client\'s batch for a legacy-only offer',
      () => assertSucceeds(joinBatch(N, 'A', 'N', 'nina@x.com', ['legacy'])));
    await checkOn(sLegacy, 'she declines it: the legacy delete lands',
      () => assertSucceeds(N.doc('invites/nina@x.com').delete()));
    await checkOn(sLegacy, 'the owner cancels it: the legacy delete lands',
      () => assertSucceeds(O.doc('invites/nina@x.com').delete()));
    await checkOn(sLegacy, 'the owner marks her mirror row (perFamily) only after a per-family ack; an owner may write it anyway',
      () => assertSucceeds(O.doc('households/A').update(new FP('pendingInvites', 'nina@x.com', 'perFamily'), true)));
    await env.cleanup();
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    console.log(fail ? 'INVITE-FAMILY-RULES (old rules): FAIL' : 'INVITE-FAMILY-RULES (old rules): PASS');
    process.exit(fail ? 1 : 0);
  }

  /* ---------------------------------------------------------------------------------------------
     1. D3. Bea, another family's owner, holds Nina's LEGACY slot (the 866851ac client still writes
        it, so the rules still let her). Olive can still invite Nina, into her own family. */
  console.log('\n1. another family holding the address does not block this one');
  const squat = () => base().then(() => seed((db) => db.doc('invites/nina@x.com').set(invDoc('B', BEA))));
  await checkOn(squat, '(the squat) Olive\'s LEGACY invite is still refused while Bea holds that slot',
    () => assertFails(O.doc('invites/nina@x.com').set(invDoc('A', OLIVE))));
  await checkOn(squat, 'Olive invites Nina into her own family at invites/nina/from/A (must SUCCEED)',
    () => assertSucceeds(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE))));
  await checkOn(squat, 'and Bea\'s legacy invite is untouched by it', async () => {
    await assertSucceeds(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE)));
    const d = await readAdmin('invites/nina@x.com');
    if (!d.exists || d.data().householdId !== 'B') throw new Error('legacy slot changed');
  });
  await checkOn(base, 'Bea (new client) invites Nina into B, Olive into A: both stand side by side', async () => {
    await assertSucceeds(B.doc(famPath('nina@x.com', 'B')).set(invDoc('B', BEA)));
    await assertSucceeds(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE)));
  });

  console.log('\n1b. nobody writes another family\'s per-family invite (must FAIL)');
  await checkOn(base, 'Bea writes invites/nina/from/A (pretending to be family A)',
    () => assertFails(B.doc(famPath('nina@x.com', 'A')).set(invDoc('A', BEA))));
  await checkOn(base, 'Bea writes invites/nina/from/B naming household A inside it',
    () => assertFails(B.doc(famPath('nina@x.com', 'B')).set(invDoc('A', BEA))));
  await checkOn(base, 'Olive writes invites/nina/from/A naming household B inside it',
    () => assertFails(O.doc(famPath('nina@x.com', 'A')).set(invDoc('B', OLIVE))));
  await checkOn(base, 'Carl, a caregiver in A, writes A\'s invite',
    () => assertFails(C.doc(famPath('nina@x.com', 'A')).set(invDoc('A', { uid: 'C', email: 'carl@x.com', name: 'Carl' }))));
  await checkOn(base, 'a stranger writes A\'s invite',
    () => assertFails(S.doc(famPath('nina@x.com', 'A')).set(invDoc('A', { uid: 'S', email: 'sam@x.com', name: 'Sam' }))));
  await checkOn(base, 'Olive mints a role that does not exist',
    () => assertFails(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE, { role: 'admin' }))));
  await checkOn(base, 'into a family that does not exist',
    () => assertFails(O.doc(famPath('nina@x.com', 'ZZ')).set(invDoc('ZZ', OLIVE))));

  console.log('\n1c. the sender proof is the legacy one exactly');
  await checkOn(base, 'own address + name (must SUCCEED)', () => assertSucceeds(O.doc(famPath('v1@x.com', 'A')).set(invDoc('A', OLIVE))));
  await checkOn(base, 'an older build: neither address nor name (must SUCCEED)',
    () => assertSucceeds(O.doc(famPath('v2@x.com', 'A')).set(unsigned(invDoc('A', OLIVE)))));
  await checkOn(base, 'a name with no address: "Your midwife" (must FAIL)',
    () => assertFails(O.doc(famPath('v3@x.com', 'A')).set(Object.assign(unsigned(invDoc('A', OLIVE)), { invitedByName: 'Your midwife' }))));
  await checkOn(base, 'someone else\'s address as the sender (must FAIL)',
    () => assertFails(O.doc(famPath('v4@x.com', 'A')).set(invDoc('A', OLIVE, { fromEmail: 'bea@x.com' }))));
  await checkOn(base, 'an empty address with a name (must FAIL)',
    () => assertFails(O.doc(famPath('v5@x.com', 'A')).set(invDoc('A', OLIVE, { fromEmail: '' }))));
  await checkOn(base, 'an UNVERIFIED owner signs with her token address (must FAIL)',
    () => assertFails(asUnverified('O', OLIVE.email).doc(famPath('v6@x.com', 'A')).set(invDoc('A', OLIVE))));
  const reinv = () => base().then(() => seed((db) => db.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE))));
  await checkOn(reinv, 're-inviting with her own address again (update, must SUCCEED)',
    () => assertSucceeds(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE, { relationship: 'Granny' }))));
  await checkOn(reinv, 're-inviting rewrites the sender to someone else (must FAIL)',
    () => assertFails(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE, { fromEmail: 'bea@x.com', invitedByName: 'Bea' }))));
  await checkOn(reinv, 'an update re-points the invite at another household (must FAIL)',
    () => assertFails(O.doc(famPath('nina@x.com', 'A')).update({ householdId: 'B' })));
  await checkOn(reinv, 'Bea updates Olive\'s invite (must FAIL)',
    () => assertFails(B.doc(famPath('nina@x.com', 'A')).update({ relationship: 'Owner' })));

  /* ---------------------------------------------------------------------------------------------
     2. Who reads what. */
  console.log('\n2. reading');
  const both = () => base().then(() => seed(async (db) => {
    await db.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE));
    await db.doc(famPath('nina@x.com', 'B')).set(invDoc('B', BEA));
  }));
  await checkOn(both, 'Nina lists her invites, from every family (must SUCCEED)', async () => {
    const q = await assertSucceeds(N.collection('invites/nina@x.com/from').get());
    if (q.size !== 2) throw new Error('listed ' + q.size + ', expected 2');
  });
  await checkOn(both, 'and reads each one (must SUCCEED)', () => assertSucceeds(N.doc(famPath('nina@x.com', 'B')).get()));
  await checkOn(both, 'Olive reads her own family\'s invite to Nina (must SUCCEED)', () => assertSucceeds(O.doc(famPath('nina@x.com', 'A')).get()));
  await checkOn(base, 'and a missing one reads as NOT FOUND, not denied (must SUCCEED, exists false)', async () => {
    const d = await assertSucceeds(O.doc(famPath('gone@x.com', 'A')).get());
    if (d.exists) throw new Error('exists');
  });
  await checkOn(both, 'Olive reads Bea\'s invite to Nina (must FAIL)', () => assertFails(O.doc(famPath('nina@x.com', 'B')).get()));
  await checkOn(both, 'Olive lists Nina\'s invites, learning who else invited her (must FAIL)', () => assertFails(O.collection('invites/nina@x.com/from').get()));
  await checkOn(both, 'Carl, a caregiver in A, reads A\'s invite (must FAIL)', () => assertFails(C.doc(famPath('nina@x.com', 'A')).get()));
  await checkOn(both, 'a stranger lists Nina\'s invites (must FAIL)', () => assertFails(S.collection('invites/nina@x.com/from').get()));
  await checkOn(both, 'an UNVERIFIED account with Nina\'s address lists them (must FAIL)', () => assertFails(asUnverified('U', 'nina@x.com').collection('invites/nina@x.com/from').get()));
  await checkOn(both, 'an UNVERIFIED account with Nina\'s address reads one (must FAIL)', () => assertFails(asUnverified('U', 'nina@x.com').doc(famPath('nina@x.com', 'A')).get()));
  await checkOn(both, 'a collection-group query across everyone\'s invites (must FAIL)', () => assertFails(S.collectionGroup('from').get()));

  /* ---------------------------------------------------------------------------------------------
     3. Declining and cancelling. */
  console.log('\n3. deleting');
  await checkOn(both, 'Nina declines Olive\'s, and only Olive\'s (must SUCCEED)', async () => {
    await assertSucceeds(N.doc(famPath('nina@x.com', 'A')).delete());
    if (!(await readAdmin(famPath('nina@x.com', 'B'))).exists) throw new Error('Bea\'s went too');
  });
  await checkOn(both, 'Olive cancels her own (must SUCCEED)', () => assertSucceeds(O.doc(famPath('nina@x.com', 'A')).delete()));
  await checkOn(base, 'Olive cancels one that is already gone (must SUCCEED: nothing to refuse)', () => assertSucceeds(O.doc(famPath('gone@x.com', 'A')).delete()));
  await checkOn(both, 'Olive deletes Bea\'s (must FAIL)', () => assertFails(O.doc(famPath('nina@x.com', 'B')).delete()));
  await checkOn(both, 'Carl, a caregiver, deletes A\'s (must FAIL)', () => assertFails(C.doc(famPath('nina@x.com', 'A')).delete()));
  await checkOn(both, 'an UNVERIFIED account with Nina\'s address deletes one (must FAIL)', () => assertFails(asUnverified('U', 'nina@x.com').doc(famPath('nina@x.com', 'A')).delete()));

  /* ---------------------------------------------------------------------------------------------
     4. Joining through the per-family invite. */
  console.log('\n4. join (legit, must SUCCEED)');
  await checkOn(both, 'Nina joins A: join + own pending row + A\'s invite deleted, one batch', () => assertSucceeds(joinBatch(N, 'A', 'N', 'nina@x.com', ['family'])));
  await check('and A\'s invite is gone, Bea\'s is not', (async () => {
    if ((await readAdmin(famPath('nina@x.com', 'A'))).exists) throw new Error('A\'s invite survived the join');
    if (!(await readAdmin(famPath('nina@x.com', 'B'))).exists) throw new Error('B\'s went too');
  })());
  // createEmailInvite writes the owner's row first, then the invite: both, as the real client leaves them.
  const coSeed = () => base().then(() => seed(async (db) => {
    await db.doc('households/A').update(new FP('pendingInvites', 'co@x.com'), { name: 'Co', role: 'owner', at: 1 });
    await db.doc(famPath('co@x.com', 'A')).set(invDoc('A', OLIVE, { role: 'owner' }));
  }));
  await checkOn(coSeed, 'a co-owner invite joins as owner', () => assertSucceeds(joinBatch(as('CO', 'co@x.com'), 'A', 'CO', 'co@x.com', ['family'], 'owner')));
  const famAndOtherLegacy = () => both().then(() => seed((db) => db.doc('invites/nina@x.com').set(invDoc('B', BEA))));
  await checkOn(famAndOtherLegacy, 'a legacy invite from ANOTHER family stays where it is', () => assertSucceeds(joinBatch(N, 'A', 'N', 'nina@x.com', ['family'])));
  const famAndOwnLegacy = () => both().then(() => seed((db) => db.doc('invites/nina@x.com').set(invDoc('A', OLIVE))));
  await checkOn(famAndOwnLegacy, 'both of A\'s grants (per-family and legacy) spent in one batch', () => assertSucceeds(joinBatch(N, 'A', 'N', 'nina@x.com', ['family', 'legacy'])));

  console.log('\n4b. join (attacks must FAIL)');
  await checkOn(both, 'the join that leaves A\'s invite behind', () => assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', [])));
  await checkOn(famAndOwnLegacy, 'the per-family join that leaves A\'s LEGACY invite behind (a way back in later)', () => assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', ['family'])));
  await checkOn(famAndOwnLegacy, 'the legacy join that leaves A\'s per-family invite behind', () => assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', ['legacy'])));
  await checkOn(both, 'Nina promotes herself to owner with a caregiver invite', () => assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', ['family'], 'owner')));
  await checkOn(both, 'Nina joins family C with A\'s invite', async () => {
    await seed((db) => db.doc('households/HC').set(hh('Z')));
    await assertFails((() => { const b = N.batch(); const upd = memberUpdate('N', 'caregiver'); b.update(N.doc('households/HC'), upd); b.delete(N.doc(famPath('nina@x.com', 'A'))); return b.commit(); })());
  });
  await checkOn(both, 'Sam, never invited, joins A deleting Nina\'s invite', async () => {
    const b = S.batch(); b.update(S.doc('households/A'), memberUpdate('S', 'caregiver')); b.delete(S.doc(famPath('nina@x.com', 'A'))); await assertFails(b.commit());
  });
  await checkOn(both, 'an UNVERIFIED account with Nina\'s address joins A', () => assertFails(joinBatch(asUnverified('U', 'nina@x.com'), 'A', 'U', 'nina@x.com', ['family'])));
  await checkOn(both, 'join batch that also sets deleteAfter', () => assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', ['family'], null, (u) => { u.deleteAfter = 1; })));
  await checkOn(both, 'join with no circle entry (joins invisibly)', () => assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', ['family'], null, (u) => { delete u['memberInfo.N']; })));
  await checkOn(both, 'join whose circle entry says owner', () => assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', ['family'], null, (u) => { u['memberInfo.N'].role = 'owner'; })));
  await checkOn(both, 'join that clears someone else\'s pending row', () => assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', ['family'], null, () => [new FP('pendingInvites', 'other@x.com'), del()])));
  await checkOn(both, 'join that also rewrites the app blob', () => assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', ['family'], null, (u) => { u.app = cleanApp(); u.app.babies = [{ id: 'planted' }]; })));
  await checkOn(() => both().then(() => seed((db) => db.doc('households/A').update({ deleteAfter: Date.now() + 9e8, deletionRequestedBy: 'O', members: {}, memberInfo: {} }))),
    'join a family already flagged for deletion', () => assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', ['family'])));
  await checkOn(both, 'she joins, Olive removes her, she tries to rejoin with nothing left', async () => {
    await assertSucceeds(joinBatch(N, 'A', 'N', 'nina@x.com', ['family']));
    await assertSucceeds(O.doc('households/A').update({ 'members.N': del(), 'memberInfo.N': del(), 'formerMemberInfo.N': { name: 'Nina', relationship: '', avatar: null } }));
    await assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', ['family']));
  });
  await checkOn(both, 'a member re-enters through the door (notYetMember)', async () => {
    await seed((db) => db.doc(famPath('carl@x.com', 'A')).set(invDoc('A', OLIVE, { role: 'owner' })));
    await assertFails(joinBatch(C, 'A', 'C', 'carl@x.com', ['family'], 'owner'));
  });

  /* ---------------------------------------------------------------------------------------------
     5. The 866851ac client under these rules: its legacy invites still create, join, decline and
        cancel, exactly as it sends them (household-guard 4b is the pattern). */
  console.log('\n5. the older client\'s legacy invites under these rules');
  await checkOn(base, 'it creates a legacy invite (must SUCCEED)', () => assertSucceeds(O.doc('invites/nina@x.com').set(invDoc('A', OLIVE))));
  const legacy = () => base().then(() => seed((db) => db.doc('invites/nina@x.com').set(invDoc('A', OLIVE))));
  await checkOn(legacy, 'its join batch (household + legacy delete) lands (must SUCCEED)', () => assertSucceeds(joinBatch(N, 'A', 'N', 'nina@x.com', ['legacy'])));
  await checkOn(legacy, 'its single-write fallback stays refused, as under R365 (must FAIL)', () => assertFails(N.doc('households/A').update(memberUpdate('N', 'caregiver'))));
  await checkOn(legacy, 'its decline deletes the legacy invite (must SUCCEED)', () => assertSucceeds(N.doc('invites/nina@x.com').delete()));
  await checkOn(legacy, 'its cancel deletes the legacy invite (must SUCCEED)', () => assertSucceeds(O.doc('invites/nina@x.com').delete()));
  await checkOn(legacy, 'its invitee reads the legacy invite (must SUCCEED)', () => assertSucceeds(N.doc('invites/nina@x.com').get()));
  await checkOn(legacy, 'an owner still cannot read a legacy invite (must FAIL)', () => assertFails(O.doc('invites/nina@x.com').get()));
  await checkOn(legacy, 'the NEW client\'s list of per-family invites works alongside a legacy one (must SUCCEED, 0 docs)', async () => {
    const q = await assertSucceeds(N.collection('invites/nina@x.com/from').get());
    if (q.size !== 0) throw new Error('listed ' + q.size);
  });

  /* ---------------------------------------------------------------------------------------------
     6. Round 2, F1. A family's own invite works only while the owner's circle still lists it.
        The 866851ac build cannot see invites/{email}/from/{hid}. Its Cancel deletes the address-keyed
        invite (refused, there is none) and then takes the row off her list, and it told her "That
        invite was already gone" while this family's own invite stayed live: her guest walked in
        after she had withdrawn him. Its Remove does the same for the address of the person removed.
        Every build clears the row, so the row is what the per-family door now checks. Each case below
        is the older build's writes, in its order, then the join it must have closed. */
  console.log('\n6. an older build\'s Cancel or Remove closes this family\'s own invite too');
  const famOnly = () => base().then(() => seed((db) => db.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE))));
  const oldCancel = async () => {
    // cancelInvite at 866851ac: the address-keyed delete (refused: there is none), then the row.
    await O.doc('invites/nina@x.com').delete().catch(() => {});
    await assertSucceeds(O.doc('households/A').update(new FP('pendingInvites', 'nina@x.com'), del()));
  };
  await checkOn(famOnly, 'after the older build\'s Cancel, she cannot join through A\'s own invite (must FAIL)', async () => {
    await oldCancel();
    await assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', ['family']));
  });
  await checkOn(famOnly, '(companion) the same join, with her row still on Olive\'s list, lands (must SUCCEED)',
    () => assertSucceeds(joinBatch(N, 'A', 'N', 'nina@x.com', ['family'])));
  // She joined A by link while A's own email invite to her was still waiting, so it was never spent.
  const memberWithInvite = () => base().then(() => seed(async (db) => {
    await db.doc('households/A').update({ 'members.N': 'caregiver', 'memberInfo.N': { name: 'Nina', role: 'caregiver' } });
    await db.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE));
  }));
  const oldRemove = async () => {
    // removeMember at 866851ac: the removal with its tombstone, the address-keyed delete, then the row.
    await assertSucceeds(O.doc('households/A').update({ 'members.N': del(), 'memberInfo.N': del(), 'formerMemberInfo.N': { name: 'Nina', relationship: '', avatar: null } }));
    await O.doc('invites/nina@x.com').delete().catch(() => {});
    await assertSucceeds(O.doc('households/A').update(new FP('pendingInvites', 'nina@x.com'), del()));
  };
  await checkOn(memberWithInvite, 'after the older build\'s Remove, she cannot walk back in through A\'s own invite (must FAIL)', async () => {
    await oldRemove();
    await assertFails(joinBatch(N, 'A', 'N', 'nina@x.com', ['family']));
  });
  await checkOn(memberWithInvite, '(companion) had her row stayed, the same rejoin would land: the row is what closes it (must SUCCEED)', async () => {
    await assertSucceeds(O.doc('households/A').update({ 'members.N': del(), 'memberInfo.N': del(), 'formerMemberInfo.N': { name: 'Nina', relationship: '', avatar: null } }));
    await assertSucceeds(joinBatch(N, 'A', 'N', 'nina@x.com', ['family']));
  });
  await checkOn(famOnly, 'the older build\'s Cancel leaves the legacy door as it was: an address-keyed invite still joins (must SUCCEED)', async () => {
    await oldCancel();
    await seed((db) => db.doc('invites/nina@x.com').set(invDoc('A', OLIVE)));
    await seed((db) => db.doc(famPath('nina@x.com', 'A')).delete());
    await assertSucceeds(joinBatch(N, 'A', 'N', 'nina@x.com', ['legacy']));
  });

  /* ---------------------------------------------------------------------------------------------
     7. Round 2, F3. Offers are asked most recent first, so a date the sender picks could put any
        number of a stranger's invites ahead of a person's real one. This family's own invite carries
        the server's clock, on every write: createEmailInvite sends serverTimestamp(). */
  console.log('\n7. this family\'s own invite is dated by the server, never by the sender');
  const at = (ms) => firebase.firestore.Timestamp.fromMillis(ms);
  await checkOn(base, 'dated a year ahead, to jump the queue (must FAIL)',
    () => assertFails(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE, { createdAt: at(Date.now() + 365 * 864e5) }))));
  await checkOn(base, 'dated a minute ahead (must FAIL)',
    () => assertFails(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE, { createdAt: at(Date.now() + 60000) }))));
  await checkOn(base, 'dated in the past (must FAIL)',
    () => assertFails(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE, { createdAt: at(Date.now() - 864e5) }))));
  await checkOn(base, 'a date as a plain number (must FAIL)',
    () => assertFails(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE, { createdAt: Date.now() + 365 * 864e5 }))));
  await checkOn(base, 'no date at all (must FAIL)', () => {
    const d = invDoc('A', OLIVE); delete d.createdAt;
    return assertFails(O.doc(famPath('nina@x.com', 'A')).set(d));
  });
  await checkOn(base, '(companion) the server\'s clock, as createEmailInvite sends it (must SUCCEED)',
    () => assertSucceeds(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE))));
  await checkOn(reinv, 're-dated a year ahead on an update (must FAIL)',
    () => assertFails(O.doc(famPath('nina@x.com', 'A')).update({ createdAt: at(Date.now() + 365 * 864e5) })));
  await checkOn(reinv, 'an update that keeps the old date (must FAIL: an invite made again is dated again)',
    () => assertFails(O.doc(famPath('nina@x.com', 'A')).update({ relationship: 'Granny' })));
  await checkOn(reinv, '(companion) made again with the server\'s clock, as "Invite again" does (must SUCCEED)',
    () => assertSucceeds(O.doc(famPath('nina@x.com', 'A')).set(invDoc('A', OLIVE, { relationship: 'Granny' }))));

  /* ---------------------------------------------------------------------------------------------
     8. Round 3, N1. The row is the owner's latest word on the ROLE too. This family's own invite
        made Rio a co-owner. The older build cannot see it: its Cancel takes the row off her list, and
        its next invite to the same address writes the row again and an address-keyed invite, both
        as a caregiver. The row is back, so section 6's check passes again, and this family's own
        invite still says owner. Joining at that withdrawn role must be refused; joining at the role
        her last invite gave must land, spending both. */
  console.log('\n8. an invite withdrawn by an older build cannot come back at its old role');
  const ownerInvite = () => base().then(() => seed(async (db) => {
    // createEmailInvite, as a co-owner invite: the row, then this family's own invite.
    await db.doc('households/A').update(new FP('pendingInvites', 'rio@x.com'), { name: 'Rio', relationship: '', role: 'owner', at: 1 });
    await db.doc(famPath('rio@x.com', 'A')).set(invDoc('A', OLIVE, { role: 'owner', name: 'Rio' }));
  }));
  const R = as('R', 'rio@x.com');
  const oldReinvite = async (role) => {
    // The 866851ac form (submitInvite there): the row first, then the address-keyed invite.
    await assertSucceeds(O.doc('households/A').update(new FP('pendingInvites', 'rio@x.com'), { name: 'Rio', relationship: '', role, at: 2 }));
    await assertSucceeds(O.doc('invites/rio@x.com').set(invDoc('A', OLIVE, { role, name: 'Rio' })));
  };
  const oldCancelRio = async () => {
    await O.doc('invites/rio@x.com').delete().catch(() => {});
    await assertSucceeds(O.doc('households/A').update(new FP('pendingInvites', 'rio@x.com'), del()));
  };
  await checkOn(ownerInvite, 'older build: Cancel, then invite again as a CAREGIVER; Rio joins as OWNER (must FAIL)', async () => {
    await oldCancelRio(); await oldReinvite('caregiver');
    await assertFails(joinBatch(R, 'A', 'R', 'rio@x.com', ['family', 'legacy'], 'owner'));
  });
  await checkOn(ownerInvite, '(companion) the same, joining as the CAREGIVER her last invite said, spending both (must SUCCEED)', async () => {
    await oldCancelRio(); await oldReinvite('caregiver');
    await assertSucceeds(joinBatch(R, 'A', 'R', 'rio@x.com', ['family', 'legacy'], 'caregiver'));
  });
  await checkOn(ownerInvite, '(companion) with no Cancel in between the owner invite still joins as owner (must SUCCEED)',
    () => assertSucceeds(joinBatch(R, 'A', 'R', 'rio@x.com', ['family'], 'owner')));
  // He joined A by link as a caregiver while A's co-owner invite to him was still waiting.
  const memberWithOwnerInvite = () => ownerInvite().then(() => seed((db) => db.doc('households/A').update({ 'members.R': 'caregiver', 'memberInfo.R': { name: 'Rio', role: 'caregiver' } })));
  await checkOn(memberWithOwnerInvite, 'older build: Remove, then invite again as a CAREGIVER; Rio walks back in as OWNER (must FAIL)', async () => {
    await assertSucceeds(O.doc('households/A').update({ 'members.R': del(), 'memberInfo.R': del(), 'formerMemberInfo.R': { name: 'Rio', relationship: '', avatar: null } }));
    await oldCancelRio(); await oldReinvite('caregiver');
    await assertFails(joinBatch(R, 'A', 'R', 'rio@x.com', ['family', 'legacy'], 'owner'));
  });
  await checkOn(memberWithOwnerInvite, '(companion) the same, back in as a CAREGIVER (must SUCCEED)', async () => {
    await assertSucceeds(O.doc('households/A').update({ 'members.R': del(), 'memberInfo.R': del(), 'formerMemberInfo.R': { name: 'Rio', relationship: '', avatar: null } }));
    await oldCancelRio(); await oldReinvite('caregiver');
    await assertSucceeds(joinBatch(R, 'A', 'R', 'rio@x.com', ['family', 'legacy'], 'caregiver'));
  });
  // The other way round: a caregiver invite, then the older build raises it to co-owner. Her latest word wins.
  const careInvite = () => base().then(() => seed(async (db) => {
    await db.doc('households/A').update(new FP('pendingInvites', 'rio@x.com'), { name: 'Rio', relationship: '', role: 'caregiver', at: 1 });
    await db.doc(famPath('rio@x.com', 'A')).set(invDoc('A', OLIVE, { name: 'Rio' }));
  }));
  await checkOn(careInvite, '(companion) older build raises it to co-owner: Rio joins as OWNER, spending both (must SUCCEED)', async () => {
    await oldReinvite('owner');
    await assertSucceeds(joinBatch(R, 'A', 'R', 'rio@x.com', ['family', 'legacy'], 'owner'));
  });
  await checkOn(careInvite, 'and with no legacy invite, the per-family door alone cannot be used at a role the row does not state (must FAIL)', async () => {
    await assertSucceeds(O.doc('households/A').update(new FP('pendingInvites', 'rio@x.com'), { name: 'Rio', relationship: '', role: 'owner', at: 2 }));
    await assertFails(joinBatch(R, 'A', 'R', 'rio@x.com', ['family'], 'caregiver'));
  });

  await env.cleanup();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'INVITE-FAMILY-RULES: FAIL' : 'INVITE-FAMILY-RULES: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
