/* Joining by LINK, which failed 100% of the time until now.
 *
 * households/{hid} update had four allow branches and a token joiner matched none of them: the
 * email path is keyed on /invites/{email} and a link joiner has no such document, only a token.
 * The client claimed the token FIRST (correctly, it is the single-use gate) and then attempted the
 * household write outside its try, so the claim stuck, the join was denied, and the exception
 * surfaced as a generic sign-in error. The token was spent by then, so the same link could never
 * work again and the invitee was told it had expired.
 *
 *   cd test && npx firebase emulators:exec --only firestore --project demo-cubby "node invite-join.test.js"
 */
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n)); };

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-cubby',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });

  const HID = 'hhLink', TOK = 'Tok123456789012345678';
  const owner = env.authenticatedContext('uidOwner', { email: 'owner@x.com', email_verified: true });
  const joiner = env.authenticatedContext('uidJoiner', { email: 'joiner@x.com', email_verified: true });
  const stranger = env.authenticatedContext('uidStranger', { email: 's@x.com', email_verified: true });

  const seed = async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await db.doc('households/' + HID).set({ ownerId: 'uidOwner', members: { uidOwner: 'owner' }, memberInfo: { uidOwner: { name: 'O', role: 'owner' } }, app: {} });
      await db.doc('inviteLinks/' + TOK).set({ householdId: HID, role: 'caregiver', invitedBy: 'uidOwner', expiresAt: new Date(Date.now() + 3600e3), usedBy: null });
    });
  };

  console.log('\n1. the whole journey a real link takes');
  await seed();
  const jdb = joiner.firestore();
  ok('the joiner can claim the token', await assertSucceeds(jdb.doc('inviteLinks/' + TOK).update({ usedBy: 'uidJoiner' })).then(() => true, () => false));
  ok('and can now JOIN the household (this is what was denied)',
    await assertSucceeds(jdb.doc('households/' + HID).update({
      joinToken: TOK, ['members.uidJoiner']: 'caregiver', ['memberInfo.uidJoiner']: { name: 'J', role: 'caregiver' },
    })).then(() => true, () => false));

  console.log('\n2. it stays a single-use gate');
  await seed();
  await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc('inviteLinks/' + TOK).update({ usedBy: 'uidJoiner' }); });
  ok('a stranger holding the same token cannot join, because they did not claim it',
    await assertFails(stranger.firestore().doc('households/' + HID).update({
      joinToken: TOK, ['members.uidStranger']: 'caregiver', ['memberInfo.uidStranger']: { name: 'S', role: 'caregiver' },
    })).then(() => true, () => false));

  console.log('\n3. no self-promotion');
  await seed();
  await jdb.doc('inviteLinks/' + TOK).update({ usedBy: 'uidJoiner' });
  ok('the joiner cannot make themselves owner', await assertFails(jdb.doc('households/' + HID).update({
    joinToken: TOK, ['members.uidJoiner']: 'owner', ['memberInfo.uidJoiner']: { name: 'J', role: 'owner' },
  })).then(() => true, () => false));
  ok('and cannot add anybody else', await assertFails(jdb.doc('households/' + HID).update({
    joinToken: TOK, ['members.uidStranger']: 'caregiver', ['memberInfo.uidStranger']: { name: 'X', role: 'caregiver' },
  })).then(() => true, () => false));

  console.log('\n4. the token must point at THIS household');
  await seed();
  await env.withSecurityRulesDisabled(async (c) => {
    await c.firestore().doc('households/hhOther').set({ ownerId: 'uidOther', members: { uidOther: 'owner' }, memberInfo: {}, app: {} });
  });
  await jdb.doc('inviteLinks/' + TOK).update({ usedBy: 'uidJoiner' });
  ok('a token for one family cannot open another', await assertFails(jdb.doc('households/hhOther').update({
    joinToken: TOK, ['members.uidJoiner']: 'caregiver', ['memberInfo.uidJoiner']: { name: 'J', role: 'caregiver' },
  })).then(() => true, () => false));

  console.log('\n5. a made-up token is worthless');
  await seed();
  ok('an unclaimed token does not admit anyone', await assertFails(jdb.doc('households/' + HID).update({
    joinToken: TOK, ['members.uidJoiner']: 'caregiver', ['memberInfo.uidJoiner']: { name: 'J', role: 'caregiver' },
  })).then(() => true, () => false));
  ok('a token that does not exist does not admit anyone', await assertFails(jdb.doc('households/' + HID).update({
    joinToken: 'NopeNopeNopeNopeNope', ['members.uidJoiner']: 'caregiver', ['memberInfo.uidJoiner']: { name: 'J', role: 'caregiver' },
  })).then(() => true, () => false));

  console.log('\n6. the client gives the token back when the join fails');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'store-firebase.js'), 'utf8');
    ok('the household write is inside the try', /catch \(e\) \{\s*console\.warn\('claimInviteLink join'/.test(src));
    ok('and a failure unclaims the token', src.includes("update({ usedBy: null })"));
    ok('the token is carried so the rule can find the link', src.includes("Object.assign({ joinToken: link.token }"));
  }

  await env.cleanup();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'INVITE-JOIN: FAIL' : 'INVITE-JOIN: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
