/* FIXTURE MODE: the admin Worker, running in Node over sample families, for the tests and the local
 * preview. Never deployed (workers/admin/dev/ is not imported by src/, and `workers` is fenced from the
 * public site).
 *
 * The Worker itself has no fixture branch and no way to skip a check. Fixture mode drives the REAL
 * handler from the outside: it mints its own Access key pair and signs a token per request, stands up a
 * fake Google over sample data, and runs real SQLite for D1.
 *
 * It REFUSES TO START (spec §6, my call 51) when the host is admin.little-cubby.com, or when any
 * production secret or binding is present in the environment it was started from: ACCESS_AUD,
 * ACCESS_TEAM_DOMAIN, ADMIN_PEOPLE, FIREBASE_READER_SA, INTERNAL_UIDS, MAIN, WRITES, or a D1 binding
 * the admin reads in production (GAMES_DB, NEWSLETTER_DB, USAGE_DB). A Worker cannot see a D1 binding's
 * database id at runtime, so "a D1 binding whose id is not a local one" is enforced two ways: those
 * production-only bindings refuse fixture mode outright, and test/admin-access.test.js checks the
 * production wrangler.toml carries no fixture setting at all.
 */
import { generateKeyPairSync, createSign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../src/index.mjs';
import { makeD1, applySqlFile } from './d1-sqlite.mjs';
import { createFakeGoogle } from './fake-google.mjs';
import { sampleWorld, seedGames, seedNewsletter, seedUsage, NOW, FOUNDER_UID } from './sample.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, '..', '..', '..');
export const MIGRATION = path.join(HERE, '..', 'migrations', '0001_init.sql');
export const USAGE_SCHEMA = path.join(ROOT, 'schema', 'usage.sql');
export const PRODUCTION_HOST = 'admin.little-cubby.com';
export const PRODUCTION_NAMES = Object.freeze(['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN', 'ADMIN_PEOPLE', 'FIREBASE_READER_SA',
  'INTERNAL_UIDS', 'MAIN', 'WRITES', 'GAMES_DB', 'NEWSLETTER_DB', 'USAGE_DB']);

export function refuseProduction(where) {
  const host = String((where && where.host) || '').toLowerCase().replace(/:\d+$/, '');
  if (host === PRODUCTION_HOST) throw new Error('fixture mode refused: the host is ' + PRODUCTION_HOST);
  const env = (where && where.env) || {};
  for (const n of PRODUCTION_NAMES) {
    if (env[n] !== undefined && env[n] !== null && env[n] !== '') throw new Error('fixture mode refused: ' + n + ' is set');
  }
}

export const TEAM = 'cubby-fixture.cloudflareaccess.com';
export const AUD = 'fixtureaudience0000000000000000000000000000000000000000000000000001';
export const FOUNDER_EMAIL = 'founder@example.com';
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function makeAccessKey(kid) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: Object.assign(publicKey.export({ format: 'jwk' }), { kid, alg: 'RS256', use: 'sig' }) };
}
export function signJwt(key, claims, header) {
  const h = Object.assign({ alg: 'RS256', kid: key.kid, typ: 'JWT' }, header || {});
  const unsigned = b64url(JSON.stringify(h)) + '.' + b64url(JSON.stringify(claims));
  const s = createSign('RSA-SHA256'); s.update(unsigned);
  return unsigned + '.' + b64url(s.sign(key.privateKey));
}
export function claimsFor(nowMs, over) {
  const t = Math.floor(nowMs / 1000);
  return Object.assign({ aud: [AUD], email: FOUNDER_EMAIL, exp: t + 3600, iat: t - 5, nbf: t - 5, iss: 'https://' + TEAM,
    sub: 'fixture-sub', type: 'app', identity_nonce: 'n', country: 'AE' }, over || {});
}

export async function buildFixture(opts) {
  opts = opts || {};
  refuseProduction({ host: opts.host, env: opts.processEnv || {} });
  let clock = opts.now || NOW;
  const now = () => clock;
  const world = sampleWorld({ content: opts.content, hostile: opts.hostile, noPrivateJourney: opts.noPrivateJourney, projectId: opts.projectId });
  const key = makeAccessKey('fixture-kid-1');
  const certKeys = [key.jwk];
  const fake = createFakeGoogle({ docs: world.docs, accounts: world.accounts, projectId: world.projectId, honorMask: opts.honorMask,
    certs: { team: TEAM, keys: () => certKeys, maxAge: opts.certsMaxAge } });
  const sa = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const admin = applySqlFile(makeD1({ hooks: opts.adminHooks }), MIGRATION);
  const games = seedGames(makeD1(), { digestLast: opts.digestLast });
  const newsletter = await seedNewsletter(makeD1(), fs.readFileSync(path.join(ROOT, 'schema', 'newsletter.sql'), 'utf8'));
  /* cubby-usage (phase 2), as real SQLite with the real schema. opts.usage: undefined leaves USAGE_DB
     unbound (as production is until the founder creates it); 'empty' binds it with no rows; 'sample' seeds
     the founder's own two weeks through the main Worker's ingest(); a function seeds it however a test needs. */
  let usage = null;
  if (opts.usage) {
    usage = applySqlFile(makeD1({ hooks: opts.usageHooks }), USAGE_SCHEMA);
    if (opts.usage === 'sample') await seedUsage(usage);
    else if (typeof opts.usage === 'function') await opts.usage(usage);
  }
  const canary = opts.canary || { ok: true, ageSeconds: 360 };
  const env = Object.assign({
    ACCESS_AUD: AUD,
    ACCESS_TEAM_DOMAIN: TEAM,
    ADMIN_PEOPLE: JSON.stringify([{ email: FOUNDER_EMAIL, name: 'Alex' }]),
    FIREBASE_READER_SA: JSON.stringify({ type: 'service_account', project_id: world.projectId,
      client_email: 'cubby-admin-reader@' + world.projectId + '.iam.gserviceaccount.com', private_key: sa.privateKey }),
    INTERNAL_UIDS: FOUNDER_UID,
    ADMIN_DAILY_READ_BUDGET: String(opts.budget || 8000),
    ADMIN_DB: admin, GAMES_DB: games, NEWSLETTER_DB: newsletter, USAGE_DB: usage || undefined,
    MAIN: { fetch: async () => new Response(JSON.stringify(canary), { status: canary.ok ? 200 : 503, headers: { 'content-type': 'application/json' } }) },
  }, opts.env || {});
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const host = opts.host || PRODUCTION_HOST;
  /* opts.fetchImpl(fake) lets a test route Google to a real emulator while keeping the fake Access certs. */
  const fetchImpl = opts.fetchImpl ? opts.fetchImpl(fake) : fake.fetchImpl;
  const handler = createHandler({ host, origin: opts.origin, fetchImpl, now, limits: opts.limits, firestoreBase: opts.firestoreBase, authBase: opts.authBase });
  const base = (opts.scheme || 'https') + '://' + host;
  const token = (over, header) => signJwt(key, claimsFor(clock, over), header);
  async function request(p, init) {
    init = init || {};
    const headers = new Headers(init.headers || {});
    if (init.jwt !== false) headers.set('cf-access-jwt-assertion', init.jwt || token());
    return handler.fetch(new Request(base + p, { method: init.method || 'GET', headers, body: init.body }), env, {});
  }
  async function tick() { return handler.scheduled({ cron: '*/15 * * * *' }, env, {}); }
  async function tickUntilDone(max) {
    let last = null;
    for (let i = 0; i < (max || 40); i++) {
      last = await tick();
      const st = admin.raw.prepare("SELECT value FROM admin_meta WHERE key = 'daily'").get();
      if (st && JSON.parse(st.value).phase === 'done') return last;
    }
    return last;
  }
  return { env, handler, fake, admin, games, newsletter, usage, world, key, certKeys, token, request, tick, tickUntilDone,
    setNow: (t) => { clock = t; }, now, base };
}
