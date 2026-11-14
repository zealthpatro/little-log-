/* Cubby Ops, the admin Worker: who gets in, and what every answer carries (spec §4.2, §4.8, S1 to S8).
 *
 *   node test/admin-access.test.js               the suite
 *   node test/admin-access.test.js --self-test   also break each rule in a temp copy and require RED
 *
 * Drives the REAL handler (workers/admin/src/index.mjs) with tokens signed by a locally generated RSA key
 * and a stubbed Access certs endpoint, D1 as real SQLite, Google as a recorder over SAMPLE families.
 * Every refusal in S2 has its own token. Nothing here touches a network.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { createHash } = require('crypto');
const { selfTest } = require('./helpers/admin-selftest');

const ROOT = process.env.ADMIN_ROOT || path.join(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400) : '')); } };
const NAMES = ['Maya', 'Rosa', 'Usha', 'Priya', 'Leena', 'maya@example.com'];
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function headersOk(res) {
  const h = res.headers;
  const bad = [];
  if (h.get('cache-control') !== 'no-store') bad.push('cache-control=' + h.get('cache-control'));
  if (h.get('x-robots-tag') !== 'noindex, nofollow, noarchive') bad.push('x-robots-tag');
  if (h.get('referrer-policy') !== 'no-referrer') bad.push('referrer-policy');
  if (h.get('x-content-type-options') !== 'nosniff') bad.push('nosniff');
  if (h.get('strict-transport-security') !== 'max-age=31536000') bad.push('hsts');
  if (h.get('content-security-policy') !== CSP) bad.push('csp');
  for (const k of h.keys()) if (/^access-control-/i.test(k)) bad.push(k);
  return bad;
}
const deniedRows = (fx) => fx.admin.raw.prepare("SELECT detail FROM access_log WHERE action = 'denied' ORDER BY seq").all().map((r) => JSON.parse(r.detail).reason);

(async () => {
  const F = await imp('workers/admin/dev/fixture.mjs');
  const S = await imp('workers/admin/dev/sample.mjs');
  const { makeD1 } = await imp('workers/admin/dev/d1-sqlite.mjs');
  console.log('\nadmin access: Access re-checked on every request, fail closed, the same headers on every answer');

  console.log('\n0. the kit itself');
  {
    const d1 = makeD1();
    d1.raw.exec('CREATE TABLE t (k TEXT PRIMARY KEY)');
    let threw = false;
    try { await d1.batch([d1.prepare('INSERT INTO t VALUES (?)').bind('a'), d1.prepare('INSERT INTO t VALUES (?)').bind('a')]); } catch (e) { threw = true; }
    ok('a D1 batch that fails part-way rolls back whole, like D1', threw && d1.raw.prepare('SELECT COUNT(*) AS n FROM t').get().n === 0);
    const fx = await F.buildFixture({});
    const other = F.makeAccessKey('fixture-kid-1');
    const forged = F.signJwt(other, F.claimsFor(fx.now()));
    ok('a token signed with the fixture key is let in', (await fx.request('/')).status === 200);
    ok('the same claims signed with another key are not', (await fx.request('/', { jwt: forged })).status === 403);
  }

  const saFor = (clientEmail, projectId) => JSON.stringify({ type: 'service_account', project_id: projectId || 'cubby-sample', client_email: clientEmail,
    private_key: '-----BEGIN ' + 'PRIVATE KEY-----\nMIIx\n-----END ' + 'PRIVATE KEY-----\n' });
  {
    const C = await imp('workers/admin/src/config.mjs');
    const env = (sa) => ({ ACCESS_AUD: F.AUD, ACCESS_TEAM_DOMAIN: F.TEAM, ADMIN_PEOPLE: JSON.stringify([{ email: F.FOUNDER_EMAIL, name: 'Alex' }]), FIREBASE_READER_SA: sa, ADMIN_DB: makeD1() });
    const codeOf = (sa) => { const r = C.readConfig(env(sa)); return r.ok ? 'ok' : r.code; };
    console.log('\n1a. FIREBASE_READER_SA must be the reader account, cubby-admin-reader@<project_id>');
    ok('cubby-admin-reader@<its own project> is accepted', codeOf(saFor('cubby-admin-reader@cubby-sample.iam.gserviceaccount.com')) === 'ok', codeOf(saFor('cubby-admin-reader@cubby-sample.iam.gserviceaccount.com')));
    ok('a firebase-adminsdk-* key is refused by name', codeOf(saFor('firebase-adminsdk-ab12c@cubby-sample.iam.gserviceaccount.com')) === 'firebase_reader_sa_is_admin_key', codeOf(saFor('firebase-adminsdk-ab12c@cubby-sample.iam.gserviceaccount.com')));
    ok('any other account is refused', codeOf(saFor('owner-everything@cubby-sample.iam.gserviceaccount.com')) === 'firebase_reader_sa_not_reader');
    ok('the reader of another project is refused', codeOf(saFor('cubby-admin-reader@another-project.iam.gserviceaccount.com')) === 'firebase_reader_sa_not_reader');
    ok('in another case, refused (the address is matched exactly)', codeOf(saFor('Cubby-Admin-Reader@cubby-sample.iam.gserviceaccount.com')) === 'firebase_reader_sa_not_reader');
  }

  console.log('\n1. fail closed: a missing or malformed secret answers 503 to everyone, with no data');
  const cases = [
    ['ACCESS_AUD missing', { ACCESS_AUD: undefined }], ['ACCESS_AUD malformed', { ACCESS_AUD: 'x' }],
    ['ACCESS_TEAM_DOMAIN missing', { ACCESS_TEAM_DOMAIN: undefined }], ['ACCESS_TEAM_DOMAIN malformed', { ACCESS_TEAM_DOMAIN: 'evil.example.com' }],
    ['ADMIN_PEOPLE missing', { ADMIN_PEOPLE: undefined }], ['ADMIN_PEOPLE not JSON', { ADMIN_PEOPLE: 'founder@example.com' }],
    ['ADMIN_PEOPLE with ZERO entries', { ADMIN_PEOPLE: '[]' }],
    ['ADMIN_PEOPLE with TWO entries (the listed address included)', { ADMIN_PEOPLE: JSON.stringify([{ email: F.FOUNDER_EMAIL, name: 'Alex' }, { email: 'second@example.com', name: 'Bo' }]) }],
    ['ADMIN_PEOPLE entry without a name', { ADMIN_PEOPLE: JSON.stringify([{ email: F.FOUNDER_EMAIL }]) }],
    ['FIREBASE_READER_SA missing', { FIREBASE_READER_SA: undefined }], ['FIREBASE_READER_SA malformed', { FIREBASE_READER_SA: '{"project_id":"x"}' }],
    ['ADMIN_DB binding missing', { ADMIN_DB: undefined }], ['ADMIN_DAILY_READ_BUDGET malformed', { ADMIN_DAILY_READ_BUDGET: 'lots' }],
    /* FIREBASE_READER_SA must be the read-only account (spec §4.3): a full-access key piped in by mistake
       (tools/serviceAccountKey.json is a firebase-adminsdk key) must turn the dashboard off, not on. */
    ['FIREBASE_READER_SA is the firebase-adminsdk master key', { FIREBASE_READER_SA: saFor('firebase-adminsdk-ab12c@cubby-sample.iam.gserviceaccount.com') }],
    ['FIREBASE_READER_SA is some other service account', { FIREBASE_READER_SA: saFor('owner-everything@cubby-sample.iam.gserviceaccount.com') }],
    ['FIREBASE_READER_SA is the reader of ANOTHER project', { FIREBASE_READER_SA: saFor('cubby-admin-reader@another-project.iam.gserviceaccount.com') }],
    ['FIREBASE_READER_SA names the reader inside a longer address', { FIREBASE_READER_SA: saFor('cubby-admin-reader@cubby-sample.iam.gserviceaccount.com.evil.example') }],
  ];
  for (const [label, env] of cases) {
    const fx = await F.buildFixture({ env });
    await fx.tickUntilDone(3).catch(() => {});
    const r = await fx.request('/');
    const body = await r.text();
    ok(label + ': 503 "Not configured"', r.status === 503 && /Not configured/.test(body), r.status);
    ok(label + ': no family data in the answer', !NAMES.some((n) => body.includes(n)));
    ok(label + ': and the §4.8 headers', headersOk(r).length === 0, headersOk(r));
    const s = await fx.request('/static/admin.css');
    ok(label + ': static files are 503 too', s.status === 503);
    const tick = await fx.tick();
    ok(label + ': the cron refreshes nothing', tick === null);
  }

  console.log('\n2. the Access JWT, re-verified on every request (S1, S2)');
  {
    const fx = await F.buildFixture({});
    await fx.tickUntilDone();
    const tok = (over, header) => fx.token(over, header);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const T = () => Math.floor(fx.now() / 1000);
    /* Tokens are made at the moment of use: the clock moves a minute between cases, because a second
       refusal for the same reason inside a minute is (rightly) not written twice. */
    const refusals = [
      ['no Cf-Access-Jwt-Assertion header', () => false, 'no_jwt'],
      ['a forged signature (another key, same kid)', () => F.signJwt(F.makeAccessKey('fixture-kid-1'), F.claimsFor(fx.now())), 'bad_signature'],
      ['expired', () => tok({ exp: T() - 61, iat: T() - 3600 }), 'expired'],
      ['issued in the future, beyond 60s', () => tok({ iat: T() + 120 }), 'not_yet_valid'],
      ['not valid before a future time', () => tok({ nbf: T() + 120 }), 'not_yet_valid'],
      ['the wrong audience', () => tok({ aud: ['another-application-aud-0000000000000000000000000000000000000000'] }), 'bad_aud'],
      ['the wrong issuer', () => tok({ iss: 'https://someone-else.cloudflareaccess.com' }), 'bad_iss'],
      ['alg none', () => b64({ alg: 'none', kid: 'fixture-kid-1' }) + '.' + b64(F.claimsFor(fx.now())) + '.x', 'bad_alg'],
      ['alg HS256 (keyed with the public key)', () => tok({}, { alg: 'HS256' }), 'bad_alg'],
      ['a service token (common_name, no email)', () => tok({ email: undefined, common_name: 'svc.access' }), 'service_token'],
      ['no email at all', () => tok({ email: undefined }), 'no_email'],
      ['an address Access allowed but ADMIN_PEOPLE does not list', () => tok({ email: 'someone-else@example.com' }), 'not_listed'],
      ['garbage', () => 'not.a.jwt!', 'malformed_jwt'],
    ];
    for (const [label, make, why] of refusals) {
      fx.setNow(fx.now() + 61000);
      const jwt = make();
      const before = fx.admin.raw.prepare("SELECT COUNT(*) AS n FROM access_log WHERE action = 'denied'").get().n;
      const r = await fx.request('/', { jwt });
      const body = await r.text();
      ok(label + ': 403 with no family data', r.status === 403 && !NAMES.some((n) => body.includes(n)), r.status);
      const rows = deniedRows(fx);
      ok(label + ': one `denied` row, reason ' + why, fx.admin.raw.prepare("SELECT COUNT(*) AS n FROM access_log WHERE action = 'denied'").get().n === before + 1 && rows[rows.length - 1] === why, rows.slice(-2));
    }
    fx.setNow(fx.now() + 61000);
    ok('the listed address in another case is let in', (await fx.request('/', { jwt: tok({ email: F.FOUNDER_EMAIL.toUpperCase() }) })).status === 200);
    await fx.request('/', { jwt: false });
    const r = await fx.request('/', { jwt: false });
    ok('a second refusal for the same reason inside a minute writes no second row', r.status === 403 && deniedRows(fx).filter((x) => x === 'no_jwt').length === 2, deniedRows(fx));
    fx.setNow(fx.now() + 61000);
    await fx.request('/', { jwt: false });
    ok('after a minute it writes one again', deniedRows(fx).filter((x) => x === 'no_jwt').length === 3, deniedRows(fx));
    const log = fx.admin.raw.prepare("SELECT actor, actor_id, detail FROM access_log WHERE action = 'denied'").all();
    ok('a denied row holds a reason code and nothing a stranger sent', log.every((x) => x.actor === 'unknown' && !/@/.test(JSON.stringify(x))), log);
  }

  console.log('\n2b. the certs: cached per Cache-Control, and junk kids cannot hammer them');
  {
    const fx = await F.buildFixture({ certsMaxAge: 300 });
    const certFetches = () => fx.fake.seen.filter((s) => s.url.endsWith('/cdn-cgi/access/certs')).length;
    await fx.request('/');
    const base = certFetches();
    for (let i = 0; i < 50; i++) await fx.request('/', { jwt: fx.token({}, { kid: 'junk-kid-' + i }) });
    ok('50 tokens with unknown kids inside a minute fetch the certs at most once more', certFetches() - base <= 1, certFetches() - base);
    fx.setNow(fx.now() + 61000);
    for (let i = 0; i < 20; i++) await fx.request('/', { jwt: fx.token({}, { kid: 'junk2-kid-' + i }) });
    ok('and a minute later, at most once more again', certFetches() - base <= 2, certFetches() - base);
    const before = certFetches();
    fx.setNow(fx.now() + 100 * 1000);
    await fx.request('/');
    ok('a known kid inside max-age=300 needs no refetch', certFetches() === before, certFetches() - before);
    fx.setNow(fx.now() + 301 * 1000);
    await fx.request('/');
    ok('past max-age the certs are fetched again', certFetches() === before + 1, certFetches() - before);
    /* Key rotation: the team signs with a new kid; the Worker learns it on the first unknown-kid refetch. */
    const k2 = F.makeAccessKey('fixture-kid-2');
    fx.certKeys.push(k2.jwk);
    fx.setNow(fx.now() + 61000);
    ok('a rotated key is accepted once the certs list it', (await fx.request('/', { jwt: F.signJwt(k2, F.claimsFor(fx.now())) })).status === 200);
  }

  console.log('\n2c. a cold isolate: requests that arrive together share the first certs fetch');
  {
    const fx = await F.buildFixture({});
    await fx.tickUntilDone();
    const certFetches = () => fx.fake.seen.filter((x) => x.url.endsWith('/cdn-cgi/access/certs')).length;
    /* A fresh handler is a fresh isolate: no certs yet. The certs answer slowly, as over a real network. */
    const cold = fx.handler;
    fx.fake.state.fault = async (u) => { if (/\/cdn-cgi\/access\/certs$/.test(u)) await new Promise((r) => setTimeout(r, 30)); return null; };
    const before = deniedRows(fx).length;
    const paths = ['/static/admin.css', '/static/admin.js', '/static/fonts/fraunces-latin.woff2', '/static/fonts/nunitosans-latin.woff2', '/'];
    const st = await Promise.all(paths.map((p) => fx.request(p).then((r) => r.status)));
    fx.fake.state.fault = null;
    ok('5 requests at once, with the founder\'s valid token, on a cold isolate: all 200', st.every((x) => x === 200), paths.map((p, i) => p + ' ' + st[i]));
    ok('from ONE certs fetch', certFetches() === 1, certFetches());
    ok('and no spurious refusal in the access log', deniedRows(fx).length === before, deniedRows(fx).slice(before));
    void cold;
  }

  console.log('\n3. the same headers on every answer, and the host and state-change rules (S5, S7, S8)');
  {
    const fx = await F.buildFixture({});
    await fx.tickUntilDone();
    const variants = [
      ['200 overview', await fx.request('/')], ['200 household', await fx.request('/household/2')],
      ['200 records', await fx.request('/records?tab=access')], ['200 CSV', await fx.request('/records.csv?tab=people')],
      ['200 stylesheet', await fx.request('/static/admin.css')], ['200 script', await fx.request('/static/admin.js')],
      ['200 font', await fx.request('/static/fonts/fraunces-latin.woff2')],
      ['403 no token', await fx.request('/', { jwt: false })], ['404', await fx.request('/no-such-page')],
      ['403 PUT', await fx.request('/', { method: 'PUT' })],
    ];
    const bad503 = await F.buildFixture({ env: { ADMIN_PEOPLE: '[]' } });
    variants.push(['503 not configured', await bad503.request('/')]);
    const broken = await F.buildFixture({});
    await broken.tickUntilDone();
    broken.admin.raw.exec('DROP TABLE dir_household_days');
    const r500 = await broken.request('/household/1');
    variants.push(['500 a route that throws', r500]);
    for (const [label, r] of variants) {
      ok(label + ' (' + r.status + ') carries no-store, noindex, nosniff, HSTS, no-referrer and the exact CSP, and no CORS header', headersOk(r).length === 0, headersOk(r));
    }
    const htmlOnes = variants.filter(([, r]) => /text\/html/.test(r.headers.get('content-type') || ''));
    let metaOk = true;
    for (const [, r] of htmlOnes) { const b = await r.clone().text().catch(() => ''); if (!/<meta name="robots" content="noindex">/.test(b)) metaOk = false; }
    ok('every HTML answer carries <meta name="robots" content="noindex">', htmlOnes.length >= 5 && metaOk, htmlOnes.length);
    const b500 = await r500.clone().text();
    ok('the 500 says nothing about a family', r500.status === 500 && !NAMES.some((n) => b500.includes(n)), r500.status);
    const wrongHost = await fx.handler.fetch(new Request('https://cubby-admin.example.workers.dev/', { headers: { 'cf-access-jwt-assertion': fx.token() } }), fx.env, {});
    ok('a valid token on another hostname (workers.dev, preview) gets 403', wrongHost.status === 403 && headersOk(wrongHost).length === 0, wrongHost.status);
    const body = JSON.stringify({ household: 2, reason: 'family_asked' });
    const post = (headers, p) => fx.request(p || '/api/manual-access', { method: 'POST', headers, body });
    ok('a POST with no Origin is refused', (await post({ 'content-type': 'application/json' })).status === 403);
    ok('a POST from another origin is refused', (await post({ origin: 'https://evil.example.com', 'content-type': 'application/json' })).status === 403);
    ok('a form-encoded POST from the admin origin is refused', (await post({ origin: 'https://admin.little-cubby.com', 'content-type': 'application/x-www-form-urlencoded' })).status === 403);
    ok('a JSON POST from the admin origin to any other path is refused', (await post({ origin: 'https://admin.little-cubby.com', 'content-type': 'application/json' }, '/records')).status === 403);
    ok('a JSON POST from the admin origin to the manual-access route is accepted', (await post({ origin: 'https://admin.little-cubby.com', 'content-type': 'application/json' })).status === 200);
  }

  console.log('\n3b. a browser loading a page ahead (prefetch, prerender) is refused BEFORE anything is logged');
  {
    const fx = await F.buildFixture({});
    await fx.tickUntilDone();
    const rows = () => fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM access_log').get().n;
    const AHEAD = [['sec-purpose', 'prefetch'], ['sec-purpose', 'prefetch;prerender'], ['purpose', 'prefetch'], ['x-moz', 'prefetch'], ['x-purpose', 'preview']];
    for (const p of ['/', '/household/4', '/records?tab=people', '/records.csv?tab=people', '/manual-access?household=4']) {
      for (const [h, v] of AHEAD) {
        fx.setNow(fx.now() + 61000);
        const n0 = rows();
        const r = await fx.request(p, { headers: { [h]: v } });
        const body = await r.text();
        ok(p + ' with ' + h + ': ' + v + ': 403, no family data, the §4.8 headers, and not one access-log row', r.status === 403 && !NAMES.some((x) => body.includes(x)) && headersOk(r).length === 0 && rows() === n0, [r.status, rows() - n0]);
      }
      const n0 = rows();
      const r = await fx.request(p);
      ok(p + ' (companion) the same request, not ahead: 200 and exactly one row', r.status === 200 && rows() === n0 + 1, [r.status, rows() - n0]);
    }
  }

  console.log('\n4. static files sit behind the same check (S6), and are Cubby\'s own fonts');
  {
    const fx = await F.buildFixture({});
    for (const p of ['/static/admin.css', '/static/admin.js', '/static/fonts/fraunces-latin.woff2', '/static/fonts/nunitosans-latin-ext.woff2']) {
      ok(p + ' without a token: 403', (await fx.request(p, { jwt: false })).status === 403);
    }
    const { FILES } = require(path.join(ROOT, 'tools', 'admin_assets_build.js'));
    for (const [served, src] of Object.entries(FILES)) {
      const r = await fx.request('/static/fonts/' + served);
      const got = Buffer.from(await r.arrayBuffer());
      const want = fs.readFileSync(path.join(ROOT, 'app', 'fonts', src));
      ok(served + ' is byte for byte app/fonts/' + src, r.status === 200 && createHash('sha256').update(got).digest('hex') === createHash('sha256').update(want).digest('hex'));
    }
    const css = await (await fx.request('/static/admin.css')).text();
    ok('the stylesheet loads nothing from another origin', !/url\((?!\/static\/)/.test(css) && !/@import/.test(css));
    ok('and uses the app\'s own tokens', ['#F4EEE3', '#2C2521', '#6E635B', '#E7DECF', '#5E6AA8', '#E29A3B', '#B06A9A'].every((c) => css.includes(c)));
  }

  console.log('\n5. fixture mode cannot start beside production, and the Worker has no way around its checks');
  {
    let threw = null;
    try { F.refuseProduction({ host: 'admin.little-cubby.com', env: {} }); } catch (e) { threw = e.message; }
    ok('fixture mode refuses the production host', !!threw, threw);
    threw = null; try { F.refuseProduction({ host: 'ADMIN.little-cubby.com:443', env: {} }); } catch (e) { threw = e.message; }
    ok('in any case, with a port', !!threw);
    /* The spec's list (§6, my call 51), written HERE, not read from the module under test: a fixture that
       quietly dropped a name from its own list would otherwise test itself against the shorter list. */
    const SPEC_NAMES = ['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN', 'ADMIN_PEOPLE', 'FIREBASE_READER_SA', 'INTERNAL_UIDS', 'MAIN', 'WRITES', 'GAMES_DB', 'NEWSLETTER_DB', 'USAGE_DB'];
    for (const n of SPEC_NAMES) {
      let t = null;
      try { F.refuseProduction({ host: '127.0.0.1:7721', env: { [n]: 'x' } }); } catch (e) { t = e.message; }
      ok('fixture mode refuses to start with ' + n + ' present', !!t && t.includes(n), t);
    }
    let fine = true; try { F.refuseProduction({ host: '127.0.0.1:7721', env: { PATH: '/bin' } }); } catch (e) { fine = false; }
    ok('and starts on a local host with none of them', fine);
    let built = null; try { await F.buildFixture({ processEnv: { ADMIN_PEOPLE: 'x' } }); } catch (e) { built = e.message; }
    ok('buildFixture itself refuses a production environment', !!built, built);
    const srcDir = path.join(ROOT, 'workers', 'admin', 'src');
    const srcs = fs.readdirSync(srcDir).filter((f) => f.endsWith('.mjs')).map((f) => [f, fs.readFileSync(path.join(srcDir, f), 'utf8')]);
    ok('nothing the Worker deploys imports the dev/ fixture', srcs.every(([, s]) => !/from\s+['"][^'"]*\/dev\//.test(s)), srcs.filter(([, s]) => /\/dev\//.test(s)).map(([f]) => f));
    ok('nothing the Worker deploys reads process.env or a FIXTURE switch', srcs.every(([, s]) => !/process\.env|ADMIN_FIXTURE|FIXTURE_MODE|SKIP_ACCESS/.test(s)));
    const toml = fs.readFileSync(path.join(ROOT, 'workers', 'admin', 'wrangler.toml'), 'utf8');
    ok('the production wrangler.toml carries no fixture setting', !/fixture/i.test(toml.replace(/^#.*$/gm, '')));
    const chk = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'tools', 'admin_assets_build.js'), '--check'], { encoding: 'utf8' });
    ok('the bundled fonts equal app/fonts (tools/admin_assets_build.js --check)', chk.status === 0, chk.stdout + chk.stderr);
  }

  if (process.argv.includes('--self-test') && !process.env.ADMIN_MUTANT) {
    selfTest(__filename, [
      { name: 'the verifier skips aud', file: 'workers/admin/src/access.mjs', find: "if (!auds.includes(opts.aud)) return { ok: false, code: 'bad_aud' };", replace: '' },
      { name: 'the verifier skips iss', file: 'workers/admin/src/access.mjs', find: "if (claims.iss !== issuer) return { ok: false, code: 'bad_iss' };", replace: '' },
      { name: 'the verifier skips the email check', file: 'workers/admin/src/access.mjs', find: "if (claims.email.trim().toLowerCase() !== opts.email) return { ok: false, code: 'not_listed' };", replace: '' },
      { name: 'a second ADMIN_PEOPLE entry is allowed', file: 'workers/admin/src/config.mjs', find: "if (people.length !== 1) return bad('admin_people_not_exactly_one');", replace: "if (!people.length) return bad('admin_people_not_exactly_one');" },
      { name: 'a missing secret still serves data', file: 'workers/admin/src/config.mjs', find: "if (typeof env[n] !== 'string' || !env[n].trim()) return bad('missing_' + n.toLowerCase());", replace: '' },
      { name: 'an answer lacks no-store', file: 'workers/admin/src/headers.mjs', find: "'cache-control': 'no-store',", replace: '' },
      { name: 'an answer lacks noindex', file: 'workers/admin/src/headers.mjs', find: "'x-robots-tag': 'noindex, nofollow, noarchive',", replace: '' },
      { name: 'an answer lacks the CSP', file: 'workers/admin/src/headers.mjs', find: "'content-security-policy': CSP,", replace: '' },
      { name: 'a page lacks the robots meta', file: 'workers/admin/src/views.mjs', find: '<meta name="robots" content="noindex">', replace: '' },
      { name: 'unknown kids refetch the certs every time', file: 'workers/admin/src/access.mjs', find: 'if (!key && now() - lastFetch >= KID_REFETCH_MS) {', replace: 'if (!key) {' },
      { name: 'static files are served before the check', file: 'workers/admin/src/index.mjs', find: "    const c = readConfig(env);\n    if (!c.ok) {", replace: "    if (url.pathname.startsWith('/static/')) return asset(url.pathname) || notFound();\n    const c = readConfig(env);\n    if (!c.ok) {" },
      { name: 'fixture mode ignores MAIN', file: 'workers/admin/dev/fixture.mjs', find: "'INTERNAL_UIDS', 'MAIN', 'WRITES'", replace: "'INTERNAL_UIDS', 'WRITES'" },
      { name: 'the host is not checked', file: 'workers/admin/src/index.mjs', find: "if (url.host !== host) { await recordDenied(cfg.db, 'host', meta); return forbidden(); }", replace: '' },
      { name: 'a form POST is accepted', file: 'workers/admin/src/index.mjs', find: "|| ct !== 'application/json'", replace: '' },
      { name: 'a request with no Access header is let in', file: 'workers/admin/src/access.mjs', find: "if (!token || typeof token !== 'string') return { ok: false, code: 'no_jwt' };", replace: "if (!token || typeof token !== 'string') return { ok: true };" },
      { name: 'the signature is not checked', file: 'workers/admin/src/access.mjs', find: "if (!good) return { ok: false, code: 'bad_signature' };", replace: '' },
      { name: 'an expired token is accepted', file: 'workers/admin/src/access.mjs', find: "if (typeof claims.exp !== 'number' || claims.exp + SKEW_S <= t) return { ok: false, code: 'expired' };", replace: '' },
      { name: 'alg none is accepted', file: 'workers/admin/src/access.mjs', find: "if (!header || header.alg !== 'RS256') return { ok: false, code: 'bad_alg' };", replace: '' },
      /* N4: the reader account only. */
      { name: 'a firebase-adminsdk key is not refused by name', file: 'workers/admin/src/config.mjs', find: "if (/^firebase-adminsdk-/i.test(clientEmail)) return bad('firebase_reader_sa_is_admin_key');", replace: '' },
      { name: 'any service account is taken as the reader', file: 'workers/admin/src/config.mjs', find: "if (!new RegExp('^' + READER_ACCOUNT", replace: "if (false && new RegExp('^' + READER_ACCOUNT" },
      /* N6: one certs fetch, shared. */
      { name: 'a cold isolate does not wait for the certs fetch in flight', file: 'workers/admin/src/access.mjs', find: '    if (inflight) { try { await inflight; } catch (e) { /* whatever keys we hold */ } }\n', replace: '' },
      /* N11: nothing loaded ahead is logged. */
      { name: 'a prefetch is served, and logged as a look', file: 'workers/admin/src/index.mjs', find: '    if (loadedAhead(request)) return forbidden();\n', replace: '' },
    ], ok);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('ADMIN-ACCESS: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); console.log('ADMIN-ACCESS: FAIL'); process.exit(1); });
