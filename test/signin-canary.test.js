/* The alarm for the four-day sign-in outage, tested against a Firestore that CHECKS THE SCOPE.
 *
 *   node test/signin-canary.test.js
 *
 * The outage of 2026-08-19 survived its ship-day verification because every assertion exercised a
 * rejection path and every one of those returns before the Firestore write. The stubs here are built
 * so that mistake cannot repeat in this file: the fake token endpoint records the scope it was asked
 * for, and the fake Firestore refuses any write whose token was not minted with datastore. So a bare
 * getAccessToken(sa) makes these tests go RED, which is the whole point of having them.
 */
const assert = require('assert');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); }
};

const SA = { project_id: 'p', client_email: 'x@y.iam.gserviceaccount.com', private_key: 'stub' };
const DATASTORE = 'https://www.googleapis.com/auth/datastore';

/* A Firestore that behaves like the real one did: it looks at what the token was minted for.
   `scopeOf` maps an opaque token string back to the scope it carried, which is what makes a missing
   datastore scope produce a 403 here exactly as it did in production. */
function makeWorld(opts) {
  opts = opts || {};
  const world = { docs: new Map(), mail: [], tokenScopes: [], deletes: 0, resendStatus: opts.resendStatus || 200 };
  const scopeOf = new Map();
  let n = 0;

  world.fetch = async (url, init) => {
    url = String(url); init = init || {};
    const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || '';
    const tok = auth.replace(/^Bearer /, '');

    if (url.indexOf('oauth2.googleapis.com') >= 0 || url.indexOf('/token') >= 0) {
      const body = String(init.body || '');
      const m = /assertion=([^&]*)/.exec(body);
      let scope = '';
      try {
        const claim = JSON.parse(Buffer.from(decodeURIComponent(m[1]).split('.')[1], 'base64url').toString());
        scope = claim.scope || '';
      } catch (e) { scope = ''; }
      world.tokenScopes.push(scope);
      const t = 'tok' + (++n);
      scopeOf.set(t, scope);
      return { ok: true, status: 200, json: async () => ({ access_token: t }) };
    }

    if (url.indexOf('firestore.googleapis.com') >= 0) {
      const id = url.split('/signinCodes/')[1].split('?')[0];
      const granted = scopeOf.get(tok) || '';
      // THE REGRESSION, modelled: no datastore scope, no write. This is what returned 502 for 4 days.
      if (granted.indexOf(DATASTORE) < 0) {
        return { ok: false, status: 403, text: async () => 'PERMISSION_DENIED: Missing or insufficient permissions.' };
      }
      if (opts.writeStatus && init.method === 'PATCH') {
        return { ok: false, status: opts.writeStatus, text: async () => 'boom' };
      }
      if (init.method === 'PATCH') {
        const fields = JSON.parse(init.body).fields;
        world.docs.set(id, opts.malformed ? { mac: fields.mac, email: fields.email } : fields);
        return { ok: true, status: 200, json: async () => ({ fields: world.docs.get(id) }) };
      }
      if (init.method === 'DELETE') { world.deletes++; world.docs.delete(id); return { ok: true, status: 200 }; }
      const doc = world.docs.get(id);
      if (!doc) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ fields: doc }) };
    }

    if (url.indexOf('api.resend.com') >= 0) {
      world.mail.push(JSON.parse(init.body));
      return { ok: world.resendStatus === 200, status: world.resendStatus, json: async () => ({}) };
    }
    throw new Error('unexpected fetch ' + url);
  };
  return world;
}

const ENV = (extra) => Object.assign({
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA),
  RESEND_API_KEY: 'rk_test',
  ALERT_EMAIL: 'founder@example.com'
}, extra || {});

(async () => {
  console.log('\nsignin canary: the alarm that did not exist\n');

  /* crypto.subtle.importKey needs a real PKCS8 key, so generate one rather than stubbing the signer:
     the point is to run getAccessToken for real and read the scope it actually asks for. */
  const { generateKeyPairSync } = require('crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  SA.private_key = privateKey.export({ type: 'pkcs8', format: 'pem' });

  const mod = await import('file://' + path.join(__dirname, '..', 'worker.js'));
  const signinCanary = mod.signinCanary;
  ok('worker.js exports signinCanary, so this can be tested at all', typeof signinCanary === 'function');

  const realFetch = globalThis.fetch;
  const run = async (world, env) => {
    globalThis.fetch = world.fetch;
    try { return await signinCanary(env || ENV()); }
    finally { globalThis.fetch = realFetch; }
  };

  console.log('\n1. the happy path, and it proves the ARTEFACT not the return value');
  let w = makeWorld();
  let v = await run(w);
  ok('a healthy sign-in path reports ok', v.ok === true, JSON.stringify(v));
  ok('and it asked for the datastore scope', (w.tokenScopes[0] || '').indexOf(DATASTORE) >= 0, w.tokenScopes[0]);
  ok('and it cleaned up after itself, leaving no document behind', w.docs.size === 0 && w.deletes > 0,
     'docs ' + w.docs.size + ', deletes ' + w.deletes);
  ok('and a healthy run mails NOBODY', w.mail.length === 0, w.mail.length + ' sent');

  console.log('\n2. the actual outage of 2026-08-19, reproduced');
  /* Not a synthetic 500. The token is minted WITHOUT datastore, exactly as a bare getAccessToken(sa)
     did, and the fake Firestore refuses it the same way the real one did. */
  /* Scoped to signinCanaryProbe's OWN body. The first version of this line searched the whole file,
     which was worthless: nine other call sites carry the same scope string, so it stayed green in the
     red run while the canary itself was using a bare token. An assertion that cannot detect the thing
     it names is not an assertion. */
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
  const probeBody = src.slice(src.indexOf('async function signinCanaryProbe'), src.indexOf('async function signinCanaryAlert'));
  ok('the canary itself asks for the datastore scope, checked inside its own body',
     probeBody.indexOf("getAccessToken(sa, 'https://www.googleapis.com/auth/datastore") >= 0,
     'signinCanaryProbe does not name the datastore scope')

  w = makeWorld({ writeStatus: 403 });
  v = await run(w);
  ok('a refused Firestore write makes the canary go RED', v.ok === false, JSON.stringify(v));
  ok('and the reason names the status, so the mail is actionable not vague',
     /403/.test(v.reason), v.reason);
  ok('and it still cleaned up', w.deletes > 0, 'deletes ' + w.deletes);

  console.log('\n3. it actually shouts, which is the half that never existed');
  ok('a failure sends exactly one alert email', w.mail.length === 1, w.mail.length + ' sent');
  ok('addressed to ALERT_EMAIL', w.mail[0] && w.mail[0].to === 'founder@example.com', JSON.stringify(w.mail[0] && w.mail[0].to));
  ok('with the reason in the body, not just "it failed"', /403/.test((w.mail[0] || {}).html || ''));
  ok('and the subject says what a parent cannot do',
     /sign-in code/i.test((w.mail[0] || {}).subject || ''), (w.mail[0] || {}).subject);

  console.log('\n4. the alarm degrades without silently pretending to work');
  w = makeWorld({ writeStatus: 403 });
  v = await run(w, ENV({ ALERT_EMAIL: '' }));
  ok('with no ALERT_EMAIL set it still fails loudly rather than throwing', v.ok === false);
  ok('and sends nothing, because there is nowhere to send it', w.mail.length === 0);

  w = makeWorld({ writeStatus: 403, resendStatus: 500 });
  v = await run(w);
  ok('if Resend itself is down the canary does not crash the cron', v.ok === false);

  console.log('\n5. a written but malformed document is not a pass');
  w = makeWorld({ malformed: true });
  v = await run(w);
  ok('a document missing exp and tries is caught', v.ok === false, JSON.stringify(v));
  ok('and the reason names the missing fields', /exp/.test(v.reason) && /tries/.test(v.reason), v.reason);

  console.log('\n6. a broken service account is a finding, not a crash');
  w = makeWorld();
  v = await run(w, ENV({ FIREBASE_SERVICE_ACCOUNT: 'not json' }));
  ok('an unparseable service account is reported', v.ok === false && /FIREBASE_SERVICE_ACCOUNT/.test(v.reason), v.reason);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('SIGNIN-CANARY: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
