/* The headers on EVERY admin response, error responses included (spec §4.8, S8). Nothing the admin
 * answers may be cached, indexed, framed, sniffed or read cross-origin, and its pages may load nothing
 * from anywhere but the admin host itself. No CORS header is ever set, so no other origin can read a
 * response even with the founder's cookie.
 */
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; "
  + "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export const SECURITY_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': CSP,
});

export function secure(res) {
  const h = new Headers(res.headers);
  for (const k of [...h.keys()]) if (/^access-control-/i.test(k)) h.delete(k);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export function htmlResponse(body, status) {
  return secure(new Response(String(body), { status: status || 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
}
export function jsonResponse(obj, status) {
  return secure(new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8' } }));
}
