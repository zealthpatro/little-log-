/* Firebase Auth, read-only: Identity Toolkit accounts:batchGet, paged, with the reader account.
 *
 * Kept, and only kept (spec §4.3): localId, email, emailVerified, createdAt, lastLoginAt, lastRefreshAt,
 * the providerIds, disabled. Everything else Identity Toolkit returns (password hashes, salts, phone
 * numbers, custom claims, display names, photo URLs) is dropped on the spot, inside this function.
 *
 * The listing is all-or-nothing: if any page fails, the whole call throws, because the caller deletes
 * directory rows for uids it does not see, and a partial listing must never read as "those people are
 * gone" (spec §4.7, §10: a lookup failure never counts as gone).
 */
export const ITK_BASE = 'https://identitytoolkit.googleapis.com/v1';

const PROVIDERS = { 'google.com': 'google', 'apple.com': 'apple', password: 'email', emailLink: 'email' };

export function keepAccount(u) {
  if (!u || typeof u.localId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(u.localId)) return null;
  const providers = new Set();
  for (const p of Array.isArray(u.providerUserInfo) ? u.providerUserInfo : []) {
    const k = PROVIDERS[p && p.providerId];
    if (k) providers.add(k);
  }
  /* A custom-token sign-in (the email code) carries no provider at all; it is still an email sign-in,
     because that is the only custom-token path Cubby has. Auth cannot tell a link from a code, so the
     one honest label is "Email" (spec §5.2). */
  if (!providers.size && u.email) providers.add('email');
  const email = typeof u.email === 'string' ? u.email.trim().toLowerCase() : '';
  return {
    uid: u.localId,
    email: /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email) ? email : '',
    emailVerified: u.emailVerified === true,
    createdAt: Number(u.createdAt) || 0,
    lastLoginAt: Number(u.lastLoginAt) || 0,
    lastRefreshAt: Date.parse(u.lastRefreshAt || '') || 0,
    providers: [...providers].sort(),
    disabled: u.disabled === true,
  };
}

export async function listAccounts(opts) {
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const base = (opts.base || ITK_BASE) + '/projects/' + opts.projectId + '/accounts:batchGet';
  const token = await opts.getToken();
  const out = new Map();
  let pageToken = '', pages = 0;
  do {
    if (++pages > 50) throw new Error('auth_too_many_pages');
    const r = await fetchImpl(base + '?maxResults=1000' + (pageToken ? '&nextPageToken=' + encodeURIComponent(pageToken) : ''),
      { headers: { authorization: 'Bearer ' + token } });
    if (opts.onRequest) opts.onRequest();
    if (!r.ok) throw new Error('auth_list_' + r.status);
    const j = await r.json();
    for (const u of (j && j.users) || []) {
      const k = keepAccount(u);
      if (k) out.set(k.uid, k);
    }
    pageToken = (j && j.nextPageToken) || '';
  } while (pageToken);
  return out;
}
