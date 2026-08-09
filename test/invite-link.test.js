'use strict';
/* Tokenised invite links — the rules, proved against the emulator rather than reasoned about.
 *
 * WHY THIS EXISTS. /invites is keyed by the invitee's lowercased email and can only be READ by the
 * person whose email it names, which is exactly why the app could truthfully say "a link on its own
 * is not enough". That is a strong property and it is not being removed: /invites is untouched.
 *
 * But it fails shut on the journey the whole product depends on. The sender has to type the other
 * adult's exact sign-in address from memory, at 3am, one-handed — and Apple's Hide My Email makes a
 * mismatch the DEFAULT for anyone invited at their real address. So /inviteLinks/{token} exists
 * beside it, and it deliberately gives up the read restriction: whoever holds the token can join.
 *
 * Three things carry the weight instead, and all three are enforced HERE, in the rules, not in the
 * client — because a client check is a suggestion:
 *   1. only the household's own owner can mint a link, pointing only at their own household
 *   2. it expires
 *   3. it is single-use, claimed atomically, so two people racing one forwarded link cannot both
 *      get in, and a link that has already been walked through is dead
 *
 * A prior audit found a hijack hole on this exact surface, so the adversarial cases below matter
 * more than the happy path: re-pointing a link at someone else's household, claiming a link that is
 * already used, claiming an expired one, and quietly promoting yourself to owner on the way in.
 *
 * Run: cd test && npx firebase emulators:exec --only firestore --project demo-cubby \
 *        "node test/invite-link.test.js"   (from the repo root, as package.json does)
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc, getDocs, collection, deleteDoc } = require('firebase/firestore');

const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const results = { pass: 0, fail: 0 };
async function check(name, p) {
  try { await p; results.pass++; console.log('  ✓ ' + name); }
  catch (e) { results.fail++; console.log('  ✗ ' + name + '   (' + ((e && e.message) || e) + ')'); }
}
const inHours = h => new Date(Date.now() + h * 3600000);

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-cubby', firestore: { rules: RULES } });
  await env.clearFirestore();

  const OWNER = 'uid_owner', OTHER_OWNER = 'uid_other_owner', JOINER = 'uid_joiner', STRANGER = 'uid_stranger';

  // Seed with rules disabled: two unrelated households, each with its own owner.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'households/H'), { members: { [OWNER]: 'owner' }, memberInfo: {}, app: {} });
    await setDoc(doc(db, 'households/H2'), { members: { [OTHER_OWNER]: 'owner' }, memberInfo: {}, app: {} });
    // a live link on H, and one already claimed, and one long expired
    await setDoc(doc(db, 'inviteLinks/tok_live'), {
      householdId: 'H', role: 'caregiver', usedBy: null, expiresAt: inHours(24), invitedBy: OWNER });
    await setDoc(doc(db, 'inviteLinks/tok_used'), {
      householdId: 'H', role: 'caregiver', usedBy: 'uid_someone_else', expiresAt: inHours(24), invitedBy: OWNER });
    await setDoc(doc(db, 'inviteLinks/tok_expired'), {
      householdId: 'H', role: 'caregiver', usedBy: null, expiresAt: inHours(-1), invitedBy: OWNER });
  });

  const owner = env.authenticatedContext(OWNER).firestore();
  const otherOwner = env.authenticatedContext(OTHER_OWNER).firestore();
  const joiner = env.authenticatedContext(JOINER).firestore();
  const stranger = env.authenticatedContext(STRANGER).firestore();
  const anon = env.unauthenticatedContext().firestore();

  console.log('\nreading a link');
  await check('a signed-in holder of the token can read it (that is the point of a token)',
    assertSucceeds(getDoc(doc(joiner, 'inviteLinks/tok_live'))));
  await check('a signed-out visitor cannot read it, token or not',
    assertFails(getDoc(doc(anon, 'inviteLinks/tok_live'))));
  /* THE ONE THAT MATTERS, and the one the first version of these rules missed. `allow read` grants
     get AND list, and a list needs no token — so a signed-in stranger could have enumerated every
     live invite and joined every household in the database. The whole model rests on the id being
     a secret, which is only true if nobody can ask for the list. */
  await check('NOBODY can list the collection, which is what makes the token a secret at all',
    assertFails(getDocs(collection(stranger, 'inviteLinks'))));
  await check('not even the household owner (her own pending links come from the household doc)',
    assertFails(getDocs(collection(owner, 'inviteLinks'))));

  console.log('\nminting a link');
  await check('the household owner can mint one for her own household',
    assertSucceeds(setDoc(doc(owner, 'inviteLinks/tok_new'), {
      householdId: 'H', role: 'caregiver', usedBy: null, expiresAt: inHours(24), invitedBy: OWNER })));
  await check('a stranger cannot mint a link into a household they do not own',
    assertFails(setDoc(doc(stranger, 'inviteLinks/tok_evil'), {
      householdId: 'H', role: 'caregiver', usedBy: null, expiresAt: inHours(24), invitedBy: STRANGER })));
  await check('nor can the owner of a DIFFERENT household',
    assertFails(setDoc(doc(otherOwner, 'inviteLinks/tok_evil2'), {
      householdId: 'H', role: 'caregiver', usedBy: null, expiresAt: inHours(24), invitedBy: OTHER_OWNER })));
  await check('a link cannot be minted pre-claimed, which would smuggle a member in',
    assertFails(setDoc(doc(owner, 'inviteLinks/tok_pre'), {
      householdId: 'H', role: 'caregiver', usedBy: STRANGER, expiresAt: inHours(24), invitedBy: OWNER })));
  await check('a bogus role can never be minted',
    assertFails(setDoc(doc(owner, 'inviteLinks/tok_role'), {
      householdId: 'H', role: 'superuser', usedBy: null, expiresAt: inHours(24), invitedBy: OWNER })));
  await check('and a link with no expiry is refused outright',
    assertFails(setDoc(doc(owner, 'inviteLinks/tok_forever'), {
      householdId: 'H', role: 'caregiver', usedBy: null, invitedBy: OWNER })));

  console.log('\nclaiming a link');
  await check('the invitee can claim a live link, once, as themselves',
    assertSucceeds(updateDoc(doc(joiner, 'inviteLinks/tok_live'), { usedBy: JOINER })));
  await check('a second person cannot claim the link the first person walked through',
    assertFails(updateDoc(doc(stranger, 'inviteLinks/tok_live'), { usedBy: STRANGER })));
  await check('an already-used link cannot be claimed',
    assertFails(updateDoc(doc(joiner, 'inviteLinks/tok_used'), { usedBy: JOINER })));
  await check('an expired link cannot be claimed',
    assertFails(updateDoc(doc(joiner, 'inviteLinks/tok_expired'), { usedBy: JOINER })));
  await check('you cannot claim a link on somebody else\'s behalf',
    assertFails(updateDoc(doc(joiner, 'inviteLinks/tok_new'), { usedBy: STRANGER })));

  console.log('\nthe adversarial cases the prior audit was about');
  await check('a claimer cannot promote themselves to owner on the way in',
    assertFails(updateDoc(doc(joiner, 'inviteLinks/tok_new'), { usedBy: JOINER, role: 'owner' })));
  await check('a claimer cannot extend the expiry while claiming',
    assertFails(updateDoc(doc(joiner, 'inviteLinks/tok_new'), { usedBy: JOINER, expiresAt: inHours(999) })));
  await check('a link can never be re-pointed at another household',
    assertFails(updateDoc(doc(owner, 'inviteLinks/tok_new'), { householdId: 'H2' })));
  await check('a stranger cannot re-point it either',
    assertFails(updateDoc(doc(stranger, 'inviteLinks/tok_new'), { householdId: 'H2', usedBy: STRANGER })));

  console.log('\nrevoking');
  await check('the owner can revoke her own link',
    assertSucceeds(deleteDoc(doc(owner, 'inviteLinks/tok_new'))));
  await check('a stranger cannot revoke somebody else\'s link',
    assertFails(deleteDoc(doc(stranger, 'inviteLinks/tok_expired'))));

  console.log('\nthe email invite is untouched');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'invites/her@example.com'), { householdId: 'H', role: 'caregiver' });
  });
  const her = env.authenticatedContext('uid_her', { email: 'her@example.com' }).firestore();
  await check('the addressee can still read the invite addressed to her',
    assertSucceeds(getDoc(doc(her, 'invites/her@example.com'))));
  await check('and somebody else still cannot',
    assertFails(getDoc(doc(stranger, 'invites/her@example.com'))));

  await env.cleanup();
  console.log('\n' + (results.fail ? 'FAIL' : 'PASS') + ' — ' + results.pass + ' passed, ' + results.fail + ' failed');
  process.exit(results.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
