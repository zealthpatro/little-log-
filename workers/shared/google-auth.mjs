/* A Google service account -> a short-lived OAuth access token, minted with WebCrypto (RS256).
 *
 * The admin Worker's account is READ-ONLY by IAM (Cloud Datastore Viewer and Firebase Authentication
 * Viewer, founder step 4). The scope asked for is cloud-platform because IAM, not the scope, is what
 * limits it; asking for a narrower scope would not make a write-capable key safe, and this key is not one.
 * One token per isolate, reused until five minutes before it expires.
 */
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const enc = new TextEncoder();
const b64url = (bytes) => {
  let s = '';
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlJson = (o) => b64url(enc.encode(JSON.stringify(o)));

function pemToDer(pem) {
  const body = String(pem).replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const raw = atob(body);
  const der = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) der[i] = raw.charCodeAt(i);
  return der.buffer;
}

export function createTokenSource(sa, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const now = opts.now || (() => Date.now());
  let cached = null;     // { token, until }
  let keyPromise = null;
  return async function getToken() {
    if (cached && now() < cached.until) return cached.token;
    if (!keyPromise) {
      keyPromise = crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    }
    const key = await keyPromise;
    const iat = Math.floor(now() / 1000);
    const unsigned = b64urlJson({ alg: 'RS256', typ: 'JWT' }) + '.'
      + b64urlJson({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 });
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + unsigned + '.' + b64url(sig),
    });
    if (!res.ok) throw new Error('token_' + res.status);
    const j = await res.json();
    if (!j || !j.access_token) throw new Error('token_shape');
    const life = Math.max(60, Number(j.expires_in) || 3600);
    cached = { token: j.access_token, until: now() + (life - 300) * 1000 };
    return cached.token;
  };
}
