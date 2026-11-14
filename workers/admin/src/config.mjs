/* The admin Worker's configuration, read fresh on every request and every tick, and FAIL CLOSED.
 *
 * Spec §4.2: if ACCESS_AUD, ACCESS_TEAM_DOMAIN, ADMIN_PEOPLE or FIREBASE_READER_SA is missing or
 * malformed, every request answers 503 "Not configured" with no data. And "only me for now" in code:
 * ADMIN_PEOPLE must hold EXACTLY one person, or the Worker answers 503 to everyone, that person included.
 * Adding a teammate is a code change and a review, never a dashboard edit.
 *
 * Nothing here is ever logged or rendered: the address in ADMIN_PEOPLE leaves this module only as a
 * value compared with the verified token's email, and as a 16-hex hash in the access log.
 */
export const ADMIN_HOST = 'admin.little-cubby.com';
export const DEFAULT_READ_BUDGET = 8000;
export const MAX_READ_BUDGET = 20000;
/* The read-only service account's name (docs/ADMIN-DEPLOY.md step 4). FIREBASE_READER_SA must be its key. */
export const READER_ACCOUNT = 'cubby-admin-reader';

const SECRET_NAMES = ['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN', 'ADMIN_PEOPLE', 'FIREBASE_READER_SA'];

function bad(code) { return { ok: false, code }; }

export function readConfig(env) {
  env = env || {};
  for (const n of SECRET_NAMES) {
    if (typeof env[n] !== 'string' || !env[n].trim()) return bad('missing_' + n.toLowerCase());
  }
  const aud = env.ACCESS_AUD.trim();
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(aud)) return bad('malformed_access_aud');

  const team = env.ACCESS_TEAM_DOMAIN.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/+$/, '');
  if (!/^[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/.test(team)) return bad('malformed_access_team_domain');

  let people;
  try { people = JSON.parse(env.ADMIN_PEOPLE); } catch (e) { return bad('malformed_admin_people'); }
  if (!Array.isArray(people)) return bad('malformed_admin_people');
  if (people.length !== 1) return bad('admin_people_not_exactly_one');
  const p = people[0] || {};
  const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad('malformed_admin_people');
  if (!/^[\p{L}][\p{L}' -]{0,39}$/u.test(name)) return bad('malformed_admin_people');

  let sa;
  try { sa = JSON.parse(env.FIREBASE_READER_SA); } catch (e) { return bad('malformed_firebase_reader_sa'); }
  if (!sa || typeof sa !== 'object' || !/^[a-z0-9-]{4,40}$/.test(String(sa.project_id || ''))
    || !/@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(String(sa.client_email || ''))
    || !/^-----BEGIN [A-Z ]*KEY-----/.test(String(sa.private_key || '').trim())) return bad('malformed_firebase_reader_sa');
  /* The reader account and nothing else (spec §4.3: "holds no write-capable Google credential"). The founder
     keeps the full-access firebase-adminsdk key on the same machine, and the secret is piped from a file
     (docs/ADMIN-DEPLOY.md step 8): one wrong path must turn the dashboard off, never give it write power. */
  const clientEmail = String(sa.client_email);
  if (/^firebase-adminsdk-/i.test(clientEmail)) return bad('firebase_reader_sa_is_admin_key');
  if (!new RegExp('^' + READER_ACCOUNT + '@' + String(sa.project_id).replace(/[-.]/g, '\\$&') + '\\.iam\\.gserviceaccount\\.com$').test(clientEmail)) return bad('firebase_reader_sa_not_reader');

  if (!env.ADMIN_DB || typeof env.ADMIN_DB.prepare !== 'function') return bad('missing_admin_db');

  let budget = DEFAULT_READ_BUDGET;
  if (env.ADMIN_DAILY_READ_BUDGET !== undefined && env.ADMIN_DAILY_READ_BUDGET !== '') {
    const s = String(env.ADMIN_DAILY_READ_BUDGET).trim();
    if (!/^\d{1,6}$/.test(s) || Number(s) > MAX_READ_BUDGET) return bad('malformed_read_budget');
    budget = Number(s);
  }

  const internal = new Set(String(env.INTERNAL_UIDS || '').split(',').map((x) => x.trim())
    .filter((x) => /^[A-Za-z0-9_-]{1,128}$/.test(x)));

  return {
    ok: true,
    cfg: {
      aud, team, email, name, sa, budget, internal,
      db: env.ADMIN_DB,
      games: env.GAMES_DB && typeof env.GAMES_DB.prepare === 'function' ? env.GAMES_DB : null,
      newsletter: env.NEWSLETTER_DB && typeof env.NEWSLETTER_DB.prepare === 'function' ? env.NEWSLETTER_DB : null,
      main: env.MAIN && typeof env.MAIN.fetch === 'function' ? env.MAIN : null,
    },
  };
}
