/* Signed in, and still looking at the page that will not let you in.
 *
 * WHY THIS EXISTS. On 2026-08-31 a brand-new parent could complete the email-code sign-in on live
 * production, hold a valid session, and be left sitting on the marketing landing with the sign-in
 * overlay still up. A reload fixed it. Nothing about the sign-in itself was wrong.
 *
 * The mechanism, end to end:
 *   1. the code path signs in with a CUSTOM token, which carries only a uid
 *   2. the ID token minted from it for a JUST-CREATED account can arrive with no `email` claim
 *   3. firestore.rules gates the invite lookup on `request.auth.token.email.lower() == email`
 *   4. .lower() on a null THROWS inside rules evaluation, and Firestore reports a rules error as
 *      permission-denied — not as a clean non-match
 *   5. resolveHousehold read invites/{email} UNGUARDED on the new-user path
 *   6. so it rejected, and onAuthStateChanged's catch called showSignIn(), which re-renders the
 *      landing WITH a live session behind it
 *
 * Step 5 is the defect. The EXISTING-user branch had wrapped its invites read in try/catch since it
 * was written; the new-user branch never did. That asymmetry is exactly why only new signups
 * stranded, and it is the thing this file holds down.
 *
 * The shape matters more than the trigger. Whatever refuses that read — a claim that has not landed,
 * a rules publish, an outage — a signed-in parent must never be handed back to the door. She cannot
 * repair that state; she will conclude sign-in failed, try again, and hit the resend cooldown, which
 * makes the second attempt look broken too.
 *
 *   node test/signin-boot.test.js
 *   node test/signin-boot.test.js --self-test
 */
const fs = require('fs');
const path = require('path');

const SELF = process.argv.includes('--self-test');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };

const STORE = fs.readFileSync(path.join(__dirname, '..', 'app', 'store-firebase.js'), 'utf8');
const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

// The body of resolveHousehold, brace-matched, so every assertion below is about THAT function and
// cannot be satisfied by similar-looking code somewhere else in a 4000-line file.
function bodyOf(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) return '';
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return end < 0 ? '' : src.slice(start, end);
}

function check(store) {
  const r = {};
  const resolve = bodyOf(store, 'async function resolveHousehold(user)');
  r.foundResolve = resolve.length > 0;

  // the new-user invite lookup, from `var email =` to the fresh-household comment that follows it
  const from = resolve.indexOf("var email = (user.email || '').toLowerCase();");
  const to = resolve.indexOf('Otherwise create a fresh household');
  const newUser = from >= 0 && to > from ? resolve.slice(from, to) : '';
  r.foundNewUserBranch = newUser.length > 0;

  const invRead = /db\.collection\('invites'\)\.doc\(email\)\.get\(\)/;
  r.readsInvites = invRead.test(newUser);
  // Every invites read on this branch must sit inside a try.
  r.guarded = /try \{\s*inv = await db\.collection\('invites'\)\.doc\(email\)\.get\(\);\s*\} catch/.test(newUser);
  r.retriesOnFreshToken = /catch \(e\) \{[\s\S]{0,200}?getIdToken\(true\)[\s\S]{0,200}?invites'\)\.doc\(email\)\.get\(\)/.test(newUser);
  // and the inner catch must NOT rethrow, or the guard is decorative
  r.doesNotRethrow = !/catch \(e2\) \{[^}]*throw/.test(newUser);
  r.toleratesNull = /if \(inv && inv\.exists\)/.test(newUser);

  r.hasFreshener = /async function freshenTokenForEmailReads\(user\)/.test(store);
  r.freshenerChecksCustom = /signInProvider === 'custom'/.test(store) && /!\(tr\.claims && tr\.claims\.email\)/.test(store);
  r.freshenerRunsFirst = /async function resolveHousehold\(user\) \{\s*await freshenTokenForEmailReads\(user\);/.test(store);
  r.freshenerCannotThrow = /catch \(e\) \{ \/\* never let a token top-up be the thing that blocks a sign-in \*\/ \}/.test(store);
  return r;
}

console.log('\n1. the rule that turns a missing claim into a refusal is still written that way');
{
  // Not a demand that it change — it is correct as a permission check. It is here so the next person
  // to read this file knows WHY the client has to be defensive: .lower() on a null throws.
  ok('invites are still read via request.auth.token.email.lower()',
    /allow read: if request\.auth != null && request\.auth\.token\.email\.lower\(\) == email;/.test(RULES));
}

console.log('\n2. a brand-new parent cannot be stranded by a refused invite lookup');
{
  const r = check(STORE);
  ok('resolveHousehold is still findable', r.foundResolve);
  ok('and its new-user branch is still findable', r.foundNewUserBranch);
  ok('it still looks up an invite by address', r.readsInvites);
  ok('THE FIX: that lookup is inside a try', r.guarded);
  ok('a refusal is retried once on a genuinely fresh token', r.retriesOnFreshToken);
  ok('and a second refusal does not rethrow into the boot handler', r.doesNotRethrow);
  ok('a null result is treated as "no invite", not dereferenced', r.toleratesNull);
}

console.log('\n3. and the token is topped up before anything is read by address');
{
  const r = check(STORE);
  ok('there is a token freshener', r.hasFreshener);
  ok('it fires only for a custom-token sign-in missing the email claim', r.freshenerChecksCustom);
  ok('it runs as the FIRST thing resolveHousehold does', r.freshenerRunsFirst);
  ok('and it can never itself become the thing that blocks sign-in', r.freshenerCannotThrow);
}

console.log('\n4. the boot handler still sends a THROW back to the door, which is why the above matters');
{
  // This is the amplifier. Left as an assertion so nobody "simplifies" the guard away believing a
  // throw here is survivable: it is not, it re-renders the sign-in screen over a live session.
  ok('onAuthStateChanged still catches and calls showSignIn',
    /catch \(err\) \{[\s\S]{0,700}?showSignIn\(errText\(err, 'Could not load your data just now/.test(STORE));
  ok('and resolveHousehold returning null still declines silently, without syncing',
    /if \(!hid\) return;/.test(STORE));
}

if (SELF) {
  console.log('\n5. --self-test: put the defect back and watch it fail');
  const broken = STORE.replace(
    /var inv = null;\s*try \{\s*inv = await db\.collection\('invites'\)\.doc\(email\)\.get\(\);\s*\} catch \(e\) \{[\s\S]*?\}\s*if \(inv && inv\.exists\)/,
    "var inv = await db.collection('invites').doc(email).get();\n      if (inv.exists)");
  ok('the mutation actually removed the guard', broken !== STORE);
  const r = check(broken);
  ok('catches: an UNGUARDED new-user invites read', r.guarded === false);
  ok('catches: no retry on a fresh token', r.retriesOnFreshToken === false);

  const noFresh = STORE.replace('await freshenTokenForEmailReads(user);\n', '');
  ok('catches: the token freshener no longer runs first', check(noFresh).freshenerRunsFirst === false);

  const rethrow = STORE.replace('catch (e2) { console.warn(', 'catch (e2) { throw e2; console.warn(');
  ok('catches: a guard that rethrows is not a guard', check(rethrow).doesNotRethrow === false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log(fail ? 'SIGNIN-BOOT: FAIL' : 'SIGNIN-BOOT: PASS');
process.exit(fail ? 1 : 0);
