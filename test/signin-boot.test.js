/* Signed in, and still looking at the page that will not let you in.
 *
 * WHAT ACTUALLY HAPPENED, told straight because the first version of this file told it wrong.
 *
 * On 2026-08-31 a brand-new parent appeared to complete the email-code sign-in on live production,
 * hold a valid session, and be left on the marketing landing with the sign-in overlay still up. It
 * looked intermittent, roughly half of runs.
 *
 * It was not a product bug. TWO AGENT SESSIONS WERE DRIVING ONE SHARED BROWSER PROFILE against
 * production auth, signing each other out and reading each other's sessions mid-run. Every strand
 * observation came from that profile. Under isolated profiles the flow booted 23 times out of 23,
 * on the fixed build AND on the build that was supposed to be broken. tools/signin_boot_probe.js is
 * the instrument that settled it: one private browser profile per run, and an identity assertion
 * before and after sign-in so a collision aborts instead of being reported as a result.
 *
 * A mechanism WAS proposed at the time and it is worth recording as disproved, so nobody re-proposes
 * it: that a custom token, which carries only a uid, yields a first ID token without the `email`
 * claim, and that firestore.rules:34 turns that into permission-denied because `.lower()` on a null
 * THROWS rather than not matching. The rule really does behave that way — test/signin-claim-rules.js
 * pins it. But the premise does not hold: minting and exchanging a token server-side for a
 * just-created account gave 6 out of 6 first tokens carrying email and email_verified. There is no
 * window. The token freshener written against that theory has been removed.
 *
 * WHAT THIS FILE STILL HOLDS, and why it is worth keeping. resolveHousehold reads invites/{email} on
 * the new-user path. The EXISTING-user branch has wrapped its equivalent read in try/catch since it
 * was written; the new-user branch never did. An unguarded read there is the whole app, because
 * onAuthStateChanged catches the throw and calls showSignIn(), handing a parent with a live session
 * back to the door. That is worth preventing on its own terms, whether or not anything is currently
 * known to refuse the read.
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

  r.noDeadFreshener = !/freshenTokenForEmailReads/.test(store);   // removed with its disproved theory
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

console.log('\n3. and the theory that was disproved is not left lying around');
{
  const r = check(STORE);
  ok('the token freshener written against it is gone', r.noDeadFreshener);
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

  ok('catches: a re-added freshener', check(STORE + '\nfreshenTokenForEmailReads').noDeadFreshener === false);

  const rethrow = STORE.replace('catch (e2) { console.warn(', 'catch (e2) { throw e2; console.warn(');
  ok('catches: a guard that rethrows is not a guard', check(rethrow).doesNotRethrow === false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log(fail ? 'SIGNIN-BOOT: FAIL' : 'SIGNIN-BOOT: PASS');
process.exit(fail ? 1 : 0);
