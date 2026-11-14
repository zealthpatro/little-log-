/* The Cloudflare Access JWT, re-verified by the Worker on EVERY request (spec §4.2, S1, S2).
 *
 * Access in front is the first lock. This is the second, so a misconfigured Access application, a
 * bypass rule added one day, a workers.dev or preview hostname, or a request that reaches the Worker any
 * other way still gets nothing:
 *
 *   1. Cf-Access-Jwt-Assertion present, else refused;
 *   2. header alg exactly RS256 (none, HS256 and everything else refused);
 *   3. signature checked against the team's certs (https://<team>/cdn-cgi/access/certs), cached per the
 *      response's Cache-Control; an unknown kid refetches at most once a minute per isolate, so junk
 *      tokens cannot hammer the certs endpoint;
 *   4. aud contains ACCESS_AUD; iss is https://<team>; exp in the future; iat and nbf not, 60s skew;
 *   5. an email, and lowercased it equals the ONE address in ADMIN_PEOPLE. A service token (common_name,
 *      no email) is refused.
 *
 * Returns a code, never a reason with data in it: codes go into the access log's `denied` rows.
 */
const SKEW_S = 60;
const KID_REFETCH_MS = 60 * 1000;
const DEFAULT_CERT_TTL_MS = 5 * 60 * 1000;
const MAX_CERT_TTL_MS = 24 * 3600 * 1000;

const dec = new TextDecoder();
function b64urlToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const b64urlJson = (s) => JSON.parse(dec.decode(b64urlToBytes(s)));

function ttlFrom(res) {
  const cc = (res.headers && res.headers.get && res.headers.get('cache-control')) || '';
  const m = /max-age=(\d+)/i.exec(cc);
  if (!m) return DEFAULT_CERT_TTL_MS;
  return Math.min(MAX_CERT_TTL_MS, Math.max(0, Number(m[1]) * 1000));
}

/* One verifier per (team, aud, email). The certs cache lives inside it, so each isolate fetches the
   certs once per TTL and tests get a fresh cache per handler. */
export function createAccessVerifier(opts) {
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const now = opts.now || (() => Date.now());
  const certsUrl = 'https://' + opts.team + '/cdn-cgi/access/certs';
  const issuer = 'https://' + opts.team;
  let keys = new Map();          // kid -> CryptoKey
  let expiresAt = 0, lastFetch = 0, fetches = 0;
  /* The certs fetch in flight, shared: requests that arrive together on a cold isolate (a page, its script,
     its fonts) all wait for the ONE fetch, instead of the later ones finding no keys yet and refusing the
     founder's valid token. */
  let inflight = null;
  const refreshShared = () => {
    if (!inflight) inflight = refresh().finally(() => { inflight = null; });
    return inflight;
  };

  async function refresh() {
    lastFetch = now();
    fetches++;
    const res = await fetchImpl(certsUrl, { headers: { accept: 'application/json' } });
    if (!res || !res.ok) throw new Error('certs_' + (res && res.status));
    const j = await res.json();
    const next = new Map();
    for (const jwk of (j && j.keys) || []) {
      if (!jwk || jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
      try {
        const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        next.set(jwk.kid, key);
      } catch (e) { /* a key we cannot import is a key that verifies nothing */ }
    }
    keys = next;
    expiresAt = now() + ttlFrom(res);
  }

  async function keyFor(kid) {
    if (inflight) { try { await inflight; } catch (e) { /* whatever keys we hold */ } }
    /* Expired: refetch, but never more than once every ten seconds, so an unreachable certs endpoint is
       not asked again by every request. Stale keys keep verifying meanwhile; with none, refuse. */
    if (now() >= expiresAt && (lastFetch === 0 || now() - lastFetch >= 10 * 1000)) {
      try { await refreshShared(); } catch (e) { /* fall through to whatever keys we hold */ }
    }
    if (!keys.size) return { code: 'certs_unavailable' };
    let key = keys.get(kid);
    if (!key && now() - lastFetch >= KID_REFETCH_MS) {
      try { await refreshShared(); } catch (e) { return { code: 'certs_unavailable' }; }
      key = keys.get(kid);
    }
    return key ? { key } : { code: 'unknown_kid' };
  }

  async function verify(token) {
    if (!token || typeof token !== 'string') return { ok: false, code: 'no_jwt' };
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, code: 'malformed_jwt' };
    let header, claims;
    try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch (e) { return { ok: false, code: 'malformed_jwt' }; }
    if (!header || header.alg !== 'RS256') return { ok: false, code: 'bad_alg' };
    if (typeof header.kid !== 'string' || !header.kid) return { ok: false, code: 'no_kid' };
    const k = await keyFor(header.kid);
    if (!k.key) return { ok: false, code: k.code };
    let good = false;
    try {
      good = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k.key, b64urlToBytes(parts[2]),
        new TextEncoder().encode(parts[0] + '.' + parts[1]));
    } catch (e) { good = false; }
    if (!good) return { ok: false, code: 'bad_signature' };
    if (!claims || typeof claims !== 'object') return { ok: false, code: 'malformed_jwt' };

    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(opts.aud)) return { ok: false, code: 'bad_aud' };
    if (claims.iss !== issuer) return { ok: false, code: 'bad_iss' };
    const t = Math.floor(now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp + SKEW_S <= t) return { ok: false, code: 'expired' };
    if (typeof claims.iat !== 'number' || claims.iat - SKEW_S > t) return { ok: false, code: 'not_yet_valid' };
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf - SKEW_S > t)) return { ok: false, code: 'not_yet_valid' };
    if (claims.common_name !== undefined) return { ok: false, code: 'service_token' };
    if (typeof claims.email !== 'string' || !claims.email) return { ok: false, code: 'no_email' };
    if (claims.email.trim().toLowerCase() !== opts.email) return { ok: false, code: 'not_listed' };
    return { ok: true };
  }

  return { verify, stats: () => ({ fetches }) };
}
