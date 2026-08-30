/* THE WHOLE SIGN-UP-BY-EMAIL FLOW, driven end to end against the REAL worker.
 *
 * Every other check we have on this is a source assertion: it reads worker.js and says "yes, that
 * string is there." This one runs the thing. It imports worker.js itself, hands it real Request
 * objects, and stubs only what lives outside our code: Resend, Firestore, Identity Toolkit, Google's
 * token endpoint. Everything between the POST and the custom token is the shipped implementation.
 *
 * It follows the parent, not the code:
 *
 *   1. she types her address and asks for a code
 *   2. ONE email is sent, and both halves are in it
 *   3. the six digits are read OUT OF THAT EMAIL'S HTML, the way she reads them in Mail
 *   4. she types them back, and gets a real signed custom token for her own account
 *   5. the code is dead the moment it is used
 *
 * That is the happy path: the code, a box to type it in, a session. The link is the second half of
 * the same email and the fallback, because a link has to land somewhere and we do not get to choose
 * where. Both are checked here, in the one email.
 *
 * WHY THE STUBS ARE HONEST. The only thing faked about the code is where it is stored; it is minted,
 * MAC'd, mailed, read back out of the mail, and verified by the real functions, against a real RSA
 * key. The custom token at the end is signature-verified against that key's public half, so "she is
 * signed in" means a token Firebase would actually accept, not a 200.
 *
 *   node test/signin-flow.test.js
 *   node test/signin-flow.test.js --self-test   (prove the flow can fail)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const { pathToFileURL } = require('url');

const SELF = process.argv.includes('--self-test');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };

const HOST = 'https://little-cubby.com';
const EMAIL = 'mum@example.com';
const OTHER = 'someone@else.com';

/* A real RSA keypair. getAccessToken and mintCustomToken both sign with subtle.importKey('pkcs8'),
   so a placeholder string would not survive the first call and nothing downstream would be real. */
const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SA = { project_id: 'little-log-a9caa', client_email: 'cubby@little-log-a9caa.iam.gserviceaccount.com', private_key: privateKey };
const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), RESEND_API_KEY: 're_test_key', MAIL_FROM: 'Cubby <noreply@mail.little-cubby.com>' };

// ---- the world outside our code -----------------------------------------------------------------
const world = {
  docs: new Map(),          // Firestore signinCodes/<id>
  users: new Map(),         // Identity Toolkit accounts, by email
  mail: [],                 // everything Resend was asked to send
  oobSerial: 0,
  scopesAsked: [],
  failFirestoreWrite: false,
  failOob: false,
  failResend: false,
};
function resetWorld() {
  world.docs.clear(); world.users.clear(); world.mail.length = 0; world.scopesAsked.length = 0;
  world.failFirestoreWrite = false; world.failOob = false; world.failResend = false;
  cacheStore.clear();
}
const cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(req) { const v = cacheStore.get(String(req.url)); return v === undefined ? undefined : new Response(v); },
    async put(req, res) { cacheStore.set(String(req.url), await res.text()); },
  },
};

const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });

/* SCOPES ARE MODELLED, not waved through, and this is the most important stub in the file.
   OAUTH_SCOPE defaults to identitytoolkit alone. A sign-in request does an Identity Toolkit call AND
   a Firestore write, so a bare getAccessToken(sa) yields a token Firestore refuses — and the code
   endpoint then 502s on every single request. That is not hypothetical: it is what production did
   from 2026-08-19 to 2026-08-23, for every user, while the source looked correct and every
   string-matching gate stayed green. A stub that hands back a valid token whatever was asked for
   would have been just as green. So the token here CARRIES the scope it was minted with, and each
   Google API refuses a token that was not minted for it, the way the real ones do. */
function tokenFor(scope) { return 'ya29.' + Buffer.from(String(scope)).toString('base64url'); }
function scopeOf(headers) {
  const h = headers || {};
  const auth = h.authorization || h.Authorization || '';
  const t = String(auth).replace(/^Bearer\s+/, '');
  if (t.indexOf('ya29.') !== 0) return '';
  try { return Buffer.from(t.slice(5), 'base64url').toString('utf8'); } catch (e) { return ''; }
}
const DENIED = () => J({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Request had insufficient authentication scopes.' } }, 403);

globalThis.fetch = async function (input, init) {
  const url = String(input && input.url ? input.url : input);
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
  const body = (init && init.body) || null;
  const scope = scopeOf(init && init.headers);

  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    // The scope is a claim inside the signed assertion, so read it back out of there.
    const asrt = decodeURIComponent(String(body || '').split('assertion=')[1] || '');
    let claimed = '';
    try { claimed = JSON.parse(Buffer.from(asrt.split('.')[1], 'base64url')).scope || ''; } catch (e) {}
    world.scopesAsked.push(claimed);
    return J({ access_token: tokenFor(claimed), expires_in: 3600 });
  }

  if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode')) {
    if (scope.indexOf('identitytoolkit') < 0) return DENIED();
    if (world.failOob) return J({ error: 'boom' }, 500);
    world.oobSerial++;
    return J({ oobLink: 'https://little-log-a9caa.firebaseapp.com/__/auth/action?mode=signIn&oobCode=OOB' + world.oobSerial + '&apiKey=AIzaTest&continueUrl=' + encodeURIComponent(HOST + '/app/') });
  }
  if (/identitytoolkit\.googleapis\.com\/v1\/projects\/[^/]+\/accounts:lookup$/.test(url)) {
    if (scope.indexOf('identitytoolkit') < 0) return DENIED();
    const b = JSON.parse(body || '{}');
    const e = (b.email || [])[0];
    const uid = world.users.get(e);
    return uid ? J({ users: [{ localId: uid, email: e }] }) : J({});
  }
  if (/identitytoolkit\.googleapis\.com\/v1\/projects\/[^/]+\/accounts$/.test(url) && method === 'POST') {
    if (scope.indexOf('identitytoolkit') < 0) return DENIED();
    const b = JSON.parse(body || '{}');
    const uid = 'uid_' + (world.users.size + 1);
    world.users.set(b.email, uid);
    return J({ localId: uid, email: b.email, emailVerified: !!b.emailVerified });
  }

  const m = url.match(/firestore\.googleapis\.com\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents\/signinCodes\/([^?]+)/);
  if (m) {
    const id = m[1];
    if (scope.indexOf('datastore') < 0) return DENIED();   // the 2026-08-19 outage, exactly
    if (method === 'PATCH') {
      if (world.failFirestoreWrite) return J({ error: 'unavailable' }, 503);
      const incoming = JSON.parse(body || '{}').fields || {};
      // An updateMask MERGES; no updateMask REPLACES. Model both, so the difference is observable.
      if (/updateMask\.fieldPaths=/.test(url)) {
        const prev = world.docs.get(id) || {};
        world.docs.set(id, Object.assign({}, prev, incoming));
      } else {
        world.docs.set(id, incoming);
      }
      return J({ name: 'documents/signinCodes/' + id });
    }
    if (method === 'DELETE') { world.docs.delete(id); return J({}); }
    const doc = world.docs.get(id);
    return doc ? J({ fields: doc }) : J({ error: { status: 'NOT_FOUND' } }, 404);
  }

  if (url === 'https://api.resend.com/emails') {
    if (world.failResend) return J({ error: 'nope' }, 422);
    const b = JSON.parse(body || '{}');
    world.mail.push(b);
    return J({ id: 'msg_' + world.mail.length });
  }
  throw new Error('unstubbed external call: ' + method + ' ' + url);
};

// ---- helpers ------------------------------------------------------------------------------------
const post = (worker, p, payload, headers) => worker.fetch(
  new Request(HOST + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', Origin: HOST }, headers || {}), body: JSON.stringify(payload) }),
  ENV, { waitUntil() {}, passThroughOnException() {} }
);
const lastMail = () => world.mail[world.mail.length - 1];
/* Read the code the way she does: off the screen. Deliberately NOT from world.docs — pulling it from
   our own storage would prove the storage works and say nothing about whether the number she can see
   is the number that opens the door. */
function codeFromEmail(html) {
  const m = String(html).match(/>(\d{6})</g);
  if (!m) return null;
  return m[m.length - 1].replace(/\D/g, '');
}
function linkFromEmail(html) {
  const m = String(html).match(/href="([^"]+)"/);
  return m ? m[1] : null;
}
function decodeJwt(t) {
  const p = String(t).split('.');
  if (p.length !== 3) return null;
  return { header: JSON.parse(Buffer.from(p[0], 'base64url')), claims: JSON.parse(Buffer.from(p[1], 'base64url')), signed: p[0] + '.' + p[1], sig: Buffer.from(p[2], 'base64url') };
}

(async () => {
  // Import the REAL worker. It ships as ESM (`export default`), and a bare .js here would be parsed
  // as CJS, so it is copied byte for byte to a .mjs and imported from there.
  const src = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-worker-'));
  let loaded = 0;
  async function loadWorker(text) {
    const f = path.join(tmpdir, 'worker' + (loaded++) + '.mjs');
    fs.writeFileSync(f, text);
    return (await import(pathToFileURL(f).href)).default;
  }
  const tmp = path.join(tmpdir, 'x');
  const worker = await loadWorker(src);
  ok('worker.js loads and exports a fetch handler', worker && typeof worker.fetch === 'function');

  let happyCode = null, happyLink = null;

  console.log('\n1. she asks for a code');
  {
    resetWorld();
    const r = await post(worker, '/api/signin-code', { email: EMAIL });
    const d = await r.json();
    ok('the request succeeds', r.status === 200 && d.ok === true, [r.status, d]);
    ok('and it says what it put in her inbox', d.hasCode === true && d.hasLink === true, d);
    ok('exactly one email was sent', world.mail.length === 1, world.mail.length);
    ok('to her, from Cubby', lastMail().to === EMAIL && /Cubby/.test(lastMail().from));
    ok('subject is about signing in', /sign-in/i.test(lastMail().subject), lastMail().subject);
    ok('one live code is stored for her', world.docs.size === 1);
    ok('and the stored record does NOT contain the code itself',
       !JSON.stringify([...world.docs.values()]).includes(codeFromEmail(lastMail().html) || 'xxxxxx'));
  }

  console.log('\n2. both halves are in that one email');
  {
    const html = lastMail().html;
    happyCode = codeFromEmail(html);
    happyLink = linkFromEmail(html);
    ok('the six digits are readable in the email', /^\d{6}$/.test(happyCode || ''), happyCode);
    ok('a tappable sign-in link is in the SAME email', !!happyLink && /oobCode=/.test(happyLink), happyLink);
    ok('the link is on our own domain, not the raw firebaseapp host', happyLink.indexOf('https://little-cubby.com/__/') === 0, happyLink);
    ok('the code is presented first, the link second', html.indexOf(happyCode) < html.indexOf(happyLink));
    ok('it tells her the code is short-lived and single use', /10 minutes, once/.test(html));
  }

  console.log('\n3. she types those six digits back in — the happy path');
  {
    const r = await post(worker, '/api/signin-verify', { email: EMAIL, code: happyCode });
    const d = await r.json();
    ok('the code read out of the email is accepted', r.status === 200 && !!d.token, [r.status, d]);

    const jwt = decodeJwt(d.token);
    ok('what comes back is a real RS256 JWT', jwt && jwt.header.alg === 'RS256', jwt && jwt.header);
    const verified = jwt && nodeCrypto.verify('RSA-SHA256', Buffer.from(jwt.signed), publicKey, jwt.sig);
    ok('signed by the service account, so Firebase would accept it', verified === true);
    ok('addressed to Identity Toolkit', jwt.claims.aud.indexOf('identitytoolkit') > -1);
    ok('it carries a uid', /^uid_/.test(jwt.claims.uid || ''), jwt.claims.uid);
    ok('short-lived', jwt.claims.exp - jwt.claims.iat === 300, jwt.claims.exp - jwt.claims.iat);

    ok('her account exists and is hers', world.users.get(EMAIL) === jwt.claims.uid);
    ok('the code is burned the moment it works', world.docs.size === 0);
    const again = await post(worker, '/api/signin-verify', { email: EMAIL, code: happyCode });
    ok('so replaying the same code fails', again.status === 400, again.status);
  }

  console.log('\n4. a returning parent lands on the SAME account, not a second one');
  {
    cacheStore.clear();
    await post(worker, '/api/signin-code', { email: EMAIL });
    const code2 = codeFromEmail(lastMail().html);
    ok('the second code is a different number', code2 !== happyCode, [happyCode, code2]);
    const d = await (await post(worker, '/api/signin-verify', { email: EMAIL, code: code2 })).json();
    ok('and it signs her into the account she already had', decodeJwt(d.token).claims.uid === world.users.get(EMAIL));
    ok('still exactly one account for that address', world.users.size === 1);
  }

  console.log('\n5. the link half of the same email is a working second route');
  {
    resetWorld();
    const r = await post(worker, '/api/send-signin-link', { email: EMAIL });
    const d = await r.json();
    ok('the link sender also succeeds', r.status === 200 && d.ok === true);
    ok('and it too reports carrying BOTH', d.hasCode === true && d.hasLink === true, d);
    const html = lastMail().html;
    const code = codeFromEmail(html), link = linkFromEmail(html);
    ok('its email has a link', !!link && /oobCode=/.test(link));
    ok('its email has a code as well', /^\d{6}$/.test(code || ''), code);
    ok('the two senders send the same subject', lastMail().subject === 'Your Cubby sign-in code', lastMail().subject);
    const v = await post(worker, '/api/signin-verify', { email: EMAIL, code: code });
    ok('and the code from the LINK email really signs her in', v.status === 200 && !!(await v.json()).token);
  }

  console.log('\n6. when half the world is down, she still gets the half that works');
  {
    resetWorld();
    world.failOob = true;                       // Identity Toolkit down: no link to be had
    let d = await (await post(worker, '/api/signin-code', { email: EMAIL })).json();
    ok('the code still goes out', d.ok === true && d.hasCode === true);
    ok('and the answer admits there is no link in it', d.hasLink === false, d);
    ok('the email really has no link', !linkFromEmail(lastMail().html));
    ok('the code in it still works', (await post(worker, '/api/signin-verify', { email: EMAIL, code: codeFromEmail(lastMail().html) })).status === 200);

    resetWorld();
    world.failFirestoreWrite = true;            // Firestore down: no code can be stored
    const rc = await post(worker, '/api/signin-code', { email: EMAIL });
    ok('the code endpoint refuses rather than mailing a code it cannot honour', rc.status === 502, rc.status);
    ok('and mails nothing at all', world.mail.length === 0);
    cacheStore.clear();
    d = await (await post(worker, '/api/send-signin-link', { email: EMAIL })).json();
    ok('but the link endpoint still gets her in', d.ok === true && d.hasLink === true);
    ok('and admits its email carries no code', d.hasCode === false, d);
    ok('so nothing on screen can offer her a code box', !codeFromEmail(lastMail().html));
  }

  console.log('\n7. the ways in that must stay shut');
  {
    resetWorld();
    for (const p of ['/api/signin-code', '/api/send-signin-link', '/api/signin-verify']) {
      const r = await worker.fetch(new Request(HOST + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"x@y.com","code":"000000"}' }), ENV, {});
      ok('no Origin is refused: ' + p, r.status === 403, r.status);
    }
    ok('mails nothing on a refused request', world.mail.length === 0);

    resetWorld();
    await post(worker, '/api/signin-code', { email: EMAIL });
    const good = codeFromEmail(lastMail().html);
    let wrong = String((Number(good) + 1) % 1000000).padStart(6, '0');
    for (let i = 0; i < 5; i++) await post(worker, '/api/signin-verify', { email: EMAIL, code: wrong });
    const after = await post(worker, '/api/signin-verify', { email: EMAIL, code: good });
    ok('five wrong guesses burn the code, so the right one no longer works', after.status === 400, after.status);
    ok('and nothing is left to guess against', world.docs.size === 0);

    resetWorld();
    await post(worker, '/api/signin-code', { email: EMAIL });
    const mine = codeFromEmail(lastMail().html);
    cacheStore.clear();
    await post(worker, '/api/signin-code', { email: OTHER });
    ok('a code minted for one address does not open another', (await post(worker, '/api/signin-verify', { email: OTHER, code: mine })).status === 400);

    resetWorld();
    await post(worker, '/api/signin-code', { email: EMAIL });
    const first = codeFromEmail(lastMail().html);
    cacheStore.clear();
    await post(worker, '/api/signin-code', { email: EMAIL });
    const second = codeFromEmail(lastMail().html);
    ok('issuing a new code kills the previous one', (await post(worker, '/api/signin-verify', { email: EMAIL, code: first })).status === 400);
    ok('and the newest one is the live one', (await post(worker, '/api/signin-verify', { email: EMAIL, code: second })).status === 200);

    resetWorld();
    await post(worker, '/api/signin-code', { email: EMAIL });
    const c = codeFromEmail(lastMail().html);
    const id = [...world.docs.keys()][0];
    world.docs.get(id).exp = { integerValue: String(Date.now() - 1000) };
    ok('an expired code is refused', (await post(worker, '/api/signin-verify', { email: EMAIL, code: c })).status === 400);

    resetWorld();
    await post(worker, '/api/signin-code', { email: EMAIL });
    const r2 = await post(worker, '/api/signin-code', { email: EMAIL });
    const d2 = await r2.json();
    ok('a repeat inside the cooldown sends NO second email', world.mail.length === 1, world.mail.length);
    ok('and says so, rather than claiming a fresh send', d2.cached === true, d2);
  }

  console.log('\n8. every sign-in token is minted for BOTH the APIs the request uses');
  {
    resetWorld();
    await post(worker, '/api/signin-code', { email: EMAIL });
    ok('issuing asked for identitytoolkit AND datastore', world.scopesAsked.length > 0
      && world.scopesAsked.every(function (sc) { return sc.indexOf('datastore') > -1 && sc.indexOf('identitytoolkit') > -1; }), world.scopesAsked);
    const before = world.scopesAsked.length;
    await post(worker, '/api/signin-verify', { email: EMAIL, code: codeFromEmail(lastMail().html) });
    ok('so does verifying', world.scopesAsked.length > before
      && world.scopesAsked.slice(before).every(function (sc) { return sc.indexOf('datastore') > -1 && sc.indexOf('identitytoolkit') > -1; }), world.scopesAsked.slice(before));
    resetWorld();
    await post(worker, '/api/send-signin-link', { email: EMAIL });
    ok('and so does the link sender, which also writes a code', world.scopesAsked.length > 0
      && world.scopesAsked.every(function (sc) { return sc.indexOf('datastore') > -1 && sc.indexOf('identitytoolkit') > -1; }), world.scopesAsked);
  }

  /* THE BLAST-RADIUS QUESTION, answered by running it rather than by reasoning about it.
     Making /api/signin-code the primary route for every surface widens what an outage there costs —
     so the fallback has to be real, and "real" means demonstrated, not designed. This reproduces the
     exact 2026-08-19 failure (bare getAccessToken, so Firestore refuses every write) across the WHOLE
     worker and asks the only question that matters: can she still get in? */
  console.log('\n9. an exact repeat of the four-day outage still lets her sign in');
  {
    resetWorld();
    const bare = src.replace(/getAccessToken\(sa, 'https:\/\/www\.googleapis\.com\/auth\/datastore https:\/\/www\.googleapis\.com\/auth\/identitytoolkit'\)/g, 'getAccessToken(sa)');
    ok('the outage is actually reproduced, not just described', bare !== src);
    const broken = await loadWorker(bare);

    const rc = await post(broken, '/api/signin-code', { email: EMAIL });
    ok('the code endpoint fails, exactly as it did in production', rc.status === 502, rc.status);
    ok('and it mails nothing rather than a code it cannot honour', world.mail.length === 0);

    /* This is what the client does next: sendEmail() = sendCode().catch(() => sendLink()). The link
       sender needs only Identity Toolkit, which the broken token still carries. */
    const rl = await post(broken, '/api/send-signin-link', { email: EMAIL });
    const dl = await rl.json();
    ok('the fallback route still works', rl.status === 200 && dl.ok === true, [rl.status, dl]);
    ok('one email goes out', world.mail.length === 1);
    ok('it carries a working sign-in link', /oobCode=/.test(linkFromEmail(lastMail().html) || ''));
    ok('it honestly reports carrying no code', dl.hasCode === false, dl);
    ok('so the panel offers no code box, and points at the link instead', !codeFromEmail(lastMail().html));

    /* The claim under test, stated as the parent would: the primary route being dead does NOT mean
       nobody can sign in. It means everyone falls back to the link, which is where non-iOS surfaces
       already were before this change, and which is strictly better than what installed iOS got
       during the real outage (an error message and no fallback at all). */
    ok('CONCLUSION: sign-in by email survives the primary route being completely dead', rl.status === 200 && !!linkFromEmail(lastMail().html));

    const store = fs.readFileSync(path.join(__dirname, '..', 'app', 'store-firebase.js'), 'utf8');
    ok('and the client really is wired to take that fallback', /return sendCode\(email\)\.catch\(function \(\) \{ return sendLink\(email\); \}\);/.test(store));
    ok('with a further fallback to Firebase\'s own sender under that', /sendSignInLinkToEmail\(email/.test(store));
    ok('and Google/Apple sign-in never touch this path at all', /signInWithPopup/.test(store) && !/signInWithPopup[\s\S]{0,200}signin-code/.test(store));
  }

  console.log('\n10. the client asks for the code first, and draws what the sender says it sent');
  {
    const store = fs.readFileSync(path.join(__dirname, '..', 'app', 'store-firebase.js'), 'utf8');
    ok('the email button asks for a code', /var SEND_LABEL = 'Send code';/.test(store));
    ok('the offer is a code, on every surface', /'Prefer email\? Get a sign-in code<\/button>'/.test(store));
    ok('no browser-guess decides the route any more', !/function codeSignin\(/.test(store));
    ok('the code sender is tried first', /return sendCode\(email\)\.catch\(function \(\) \{ return sendLink\(email\); \}\);/.test(store));
    ok('and the panel is drawn from hasCode/hasLink, not from a guess', /var hasCode = !!res\.hasCode, hasLink = !!res\.hasLink;/.test(store));
    ok('no code box unless the sender said there is a code', /if \(hasCode\) showCodeBox\(email\)\.focus\(\); else codeForm\.style\.display = 'none';/.test(store));
    ok('one panel, so the two routes cannot drift apart again', (store.match(/function showEmailSent\(/g) || []).length === 1
      && !/function showSent\(/.test(store) && !/function showCodeEntry\(/.test(store));
    ok('the code leads the copy and the link follows', store.indexOf('Type the 6-digit code from that email here.') < store.indexOf('Or tap the link in it'));
  }

  /* --self-test: a flow test that cannot fail is a green light wired to nothing. Break the parts the
     parent actually depends on and require each break to show up as a failed sign-in. */
  if (SELF) {
    console.log('\n11. --self-test: break the flow and watch it fail');
    /* The regression that took the code path down for four days in production, reproduced: drop the
       explicit scopes and let OAUTH_SCOPE default to identitytoolkit alone. Every string-matching
       gate stayed green through that outage. This one must not. */
    {
      resetWorld();
      const bare = src.replace(/getAccessToken\(sa, 'https:\/\/www\.googleapis\.com\/auth\/datastore https:\/\/www\.googleapis\.com\/auth\/identitytoolkit'\)/g, 'getAccessToken(sa)');
      ok('the mutation actually changed something', bare !== src);
      const brokenWorker = await loadWorker(bare);
      const r = await post(brokenWorker, '/api/signin-code', { email: EMAIL });
      ok('catches: a token minted without the datastore scope', r.status !== 200, r.status);
      ok('and nothing was mailed on that request', world.mail.length === 0);
    }

    resetWorld();
    await post(worker, '/api/signin-code', { email: EMAIL });
    const html = lastMail().html, real = codeFromEmail(html);

    const notTheCode = String((Number(real) + 7) % 1000000).padStart(6, '0');
    ok('catches: the email shows a number that is not the stored code',
       (await post(worker, '/api/signin-verify', { email: EMAIL, code: notTheCode })).status !== 200);

    resetWorld();
    world.failResend = true;
    const r = await post(worker, '/api/signin-code', { email: EMAIL });
    ok('catches: the mail never actually leaves', r.status === 502 && world.mail.length === 0, r.status);

    resetWorld();
    await post(worker, '/api/signin-code', { email: EMAIL });
    const id = [...world.docs.keys()][0];
    world.docs.get(id).mac = { stringValue: 'dGFtcGVyZWQ' };
    ok('catches: the stored MAC is tampered with',
       (await post(worker, '/api/signin-verify', { email: EMAIL, code: codeFromEmail(lastMail().html) })).status !== 200);

    // A merging PATCH is what an updateMask would cause: the old mac survives and two codes are live.
    resetWorld();
    await post(worker, '/api/signin-code', { email: EMAIL });
    const c1 = codeFromEmail(lastMail().html);
    const only = [...world.docs.keys()][0];
    const keep = Object.assign({}, world.docs.get(only));
    cacheStore.clear();
    await post(worker, '/api/signin-code', { email: EMAIL });
    world.docs.set(only, Object.assign({}, world.docs.get(only), { mac: keep.mac }));   // simulate a merge
    ok('catches: a merging write would leave the OLD code alive',
       (await post(worker, '/api/signin-verify', { email: EMAIL, code: c1 })).status === 200);

    const tplBroken = html.replace(real, '');
    ok('catches: the code missing from the email body', codeFromEmail(tplBroken) !== real);
  }

  try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SIGNIN-FLOW: FAIL' : 'SIGNIN-FLOW: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
