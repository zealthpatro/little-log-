/* The rules half of the 2026-08-31 strand: why a valid session can be refused.
 *
 * firestore.rules gates the invite lookup on `request.auth.token.email.lower() == email`. If the
 * token has no `email` claim, .lower() is called on a null, which THROWS inside rules evaluation —
 * and Firestore reports a rules error as permission-denied, indistinguishable from a real refusal.
 *
 * A custom-token sign-in (the email-code path) is exactly the case that can present such a token.
 * So this is not a hypothetical: it is the mechanism that put a signed-in parent back on the landing.
 *
 * The client is defensive about it (test/signin-boot.test.js). This file pins the server-side fact
 * that makes that defence necessary, so nobody removes the guard after reading the rule and
 * concluding a missing claim would simply not match.
 *
 * Needs the Firestore emulator; runs from tools/gates.js --emulator.
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');

const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
let pass = 0, fail = 0;
const ok = async (n, p) => { try { await p; pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + '  (' + ((e && e.message) || e).toString().slice(0, 120) + ')'); } };

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-cubby', firestore: { rules: RULES } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'invites/mum@x.com'), { householdId: 'H' });
  });

  console.log('\n1. a token that carries its address reads its own invite');
  const withEmail = env.authenticatedContext('u1', { email: 'mum@x.com', email_verified: true }).firestore();
  await ok('allowed', assertSucceeds(getDoc(doc(withEmail, 'invites/mum@x.com'))));

  console.log('\n2. a token with NO email claim is REFUSED, not simply unmatched');
  /* This is the whole point. It reads like a permission problem and it is really a null dereference
     in the rule, so the client cannot tell the two apart and must survive both. */
  const noEmail = env.authenticatedContext('u2', {}).firestore();
  await ok('its own-address read is refused', assertFails(getDoc(doc(noEmail, 'invites/mum@x.com'))));
  await ok('and so is any other address', assertFails(getDoc(doc(noEmail, 'invites/other@x.com'))));

  console.log('\n3. the refusal is still a real permission boundary, not just a null bug');
  const other = env.authenticatedContext('u3', { email: 'someone@else.com', email_verified: true }).firestore();
  await ok('a valid token cannot read somebody else\'s invite', assertFails(getDoc(doc(other, 'invites/mum@x.com'))));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SIGNIN-CLAIM-RULES: FAIL' : 'SIGNIN-CLAIM-RULES: PASS');
  await env.cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
