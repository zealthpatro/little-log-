/* Cubby edge worker.
   - Proxies the reserved Firebase namespace (/__/*) to firebaseapp.com so Google sign-in
     runs on little-cubby.com itself (authDomain = little-cubby.com).
   - POST /api/send-signin-link: mints a Firebase email sign-in link via the Identity Toolkit
     Admin API (service account) and sends it through Resend, from our own domain. We do this
     because Firebase's built-in email sender has poor Gmail deliverability. The client still
     completes sign-in with signInWithEmailLink(); only the SENDING moves here.
   - Everything else: static assets.

   Secrets (set with `wrangler secret put`, never in the repo):
     RESEND_API_KEY            - Resend API key
     FIREBASE_SERVICE_ACCOUNT  - the service-account JSON (one line), used to mint the link
   Vars (wrangler.toml): MAIL_FROM - the verified Resend sender, e.g. "Cubby <noreply@mail.little-cubby.com>"
*/

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OOB_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode';

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { 'content-type': 'application/json' } });
}
function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(s) { return b64url(new TextEncoder().encode(s)); }
function pemToDer(pem) {
  const body = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const raw = atob(body);
  const der = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) der[i] = raw.charCodeAt(i);
  return der.buffer;
}

// Service account -> short-lived OAuth access token (RS256 JWT signed via WebCrypto).
async function getAccessToken(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: sa.client_email, scope: scope || OAUTH_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = b64urlStr(JSON.stringify(header)) + '.' + b64urlStr(JSON.stringify(claim));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = unsigned + '.' + b64url(sig);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + assertion
  });
  if (!res.ok) throw new Error('token ' + res.status);
  return (await res.json()).access_token;
}

// Ask Identity Toolkit for the email sign-in link instead of letting it send the email.
async function generateSignInLink(token, email, continueUrl) {
  const res = await fetch(OOB_URL, {
    method: 'POST',
    headers: { 'authorization': 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ requestType: 'EMAIL_SIGNIN', email: email, continueUrl: continueUrl, canHandleCodeInApp: true, returnOobLink: true })
  });
  const data = await res.json();
  if (!res.ok) throw new Error('oob ' + res.status);
  return data.oobLink;
}

function emailHtml(link) {
  return '<!doctype html><html><body style="margin:0;background:#F7F2E8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:28px 16px">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
    + '<table role="presentation" width="100%" style="max-width:440px;background:#fff;border-radius:18px;padding:32px 28px;box-shadow:0 8px 28px rgba(0,0,0,.08)">'
    + '<tr><td align="center" style="font-size:40px">🐻</td></tr>'
    + '<tr><td align="center" style="font-family:Georgia,serif;font-size:24px;color:#2C2521;padding:6px 0 4px">Sign in to Cubby</td></tr>'
    + '<tr><td align="center" style="font-size:15px;color:#6E635B;line-height:1.5;padding:0 0 22px">Tap the button to sign in. This link works once and expires soon. If you didn\'t ask for it, you can safely ignore this email.</td></tr>'
    + '<tr><td align="center"><a href="' + link + '" style="display:inline-block;background:#C97FA0;color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 30px;border-radius:12px">Sign in to Cubby</a></td></tr>'
    + '<tr><td align="center" style="font-size:12px;color:#9a8d80;padding:22px 0 0;line-height:1.5">Or paste this link into your browser:<br><span style="color:#6E635B;word-break:break-all">' + link + '</span></td></tr>'
    + '</table><div style="font-size:12px;color:#9a8d80;padding:16px 0 0">Cubby · the only app you\'ll ever need, from two lines to big kid</div>'
    + '</td></tr></table></body></html>';
}

// Canonicalize an email for the anti-abuse cooldown key ONLY (never for delivery): drop +tags,
// and dots in the local part for Gmail/Googlemail, so a+1@/a+2@/a.b@ share one cooldown bucket.
function cooldownKeyFor(email) {
  var at = email.indexOf('@'); if (at < 0) return email;
  var local = email.slice(0, at), domain = email.slice(at + 1);
  var plus = local.indexOf('+'); if (plus >= 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replace(/\./g, '');
  return local + '@' + domain;
}

async function sendSigninLink(request, env) {
  // Same-origin only. Require an Origin OR Referer matching our host, else reject — this closes
  // the no-Origin bypass (scripted clients that omit the header). Per-IP volume is then capped by
  // the SIGNIN_RATE_LIMITER binding (wrangler.toml: 5 / 60s / IP / colo); the per-email cooldown
  // below stops same-address repeats.
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  let sameOrigin = false;
  try {
    if (origin) sameOrigin = new URL(origin).host === url.host;
    else if (referer) sameOrigin = new URL(referer).host === url.host;
  } catch (e) { sameOrigin = false; }
  if (!sameOrigin) return json({ error: 'forbidden' }, 403);

  // Per-IP rate limit (volume defense). Counts every request to this endpoint regardless of body,
  // so garbage floods consume the budget too. Fail open if the binding is missing so a config gap
  // can never block real sign-ins; same-origin + the per-email cooldown still apply.
  if (env.SIGNIN_RATE_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    try {
      const { success } = await env.SIGNIN_RATE_LIMITER.limit({ key: ip });
      if (!success) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } });
    } catch (e) { /* limiter unavailable: fail open */ }
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, 400); }
  const email = ((body && body.email) || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return json({ error: 'invalid_email' }, 400);

  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); } catch (e) { return json({ error: 'server_config' }, 500); }
  if (!env.RESEND_API_KEY) return json({ error: 'server_config' }, 500);

  // Light per-email cooldown (normalized key) to absorb rapid re-sends; set only AFTER a real send.
  const cache = caches.default;
  const cooldown = new Request('https://cooldown.cubby.internal/' + encodeURIComponent(cooldownKeyFor(email)));
  if (await cache.match(cooldown)) return json({ ok: true, cached: true });

  try {
    const token = await getAccessToken(sa);
    let link = await generateSignInLink(token, email, url.origin + '/app/');
    // Rebrand the link onto our own domain (the worker proxies /__/* to Firebase) so the sign-in
    // email never exposes the legacy little-log-a9caa.firebaseapp.com host.
    link = link.replace(/^https:\/\/[^/]+\/__\//, 'https://' + url.host + '/__/');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.MAIL_FROM || 'Cubby <noreply@mail.little-cubby.com>',
        to: email,
        subject: 'Your Cubby sign-in link',
        html: emailHtml(link)
      })
    });
    if (!r.ok) return json({ error: 'send_failed' }, 502);
    await cache.put(cooldown, new Response('1', { headers: { 'cache-control': 'max-age=60' } })); // start cooldown only on success
    return json({ ok: true });
  } catch (e) {
    return json({ error: 'failed' }, 500);
  }
}

function sha256hex(s) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) {
    return [].map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  });
}

// Newsletter opt-in capture. Stores the subscriber in a Cloudflare D1 database (NEWSLETTER_DB),
// deliberately ISOLATED from Firestore family-health data — a Worker-secret leak can't reach baby
// logs, only this email list. The email is also hashed (email_hash) as the primary key so a
// re-subscribe de-dupes. Capture only — no email is sent here; the send stream (news. subdomain)
// is Phase 2 (EMAIL.md §2/§8).
async function newsletterSignup(request, env) {
  // Same-origin only (closes scripted no-Origin abuse), then per-IP volume cap (fail open).
  const url = new URL(request.url);
  const origin = request.headers.get('origin'), referer = request.headers.get('referer');
  let sameOrigin = false;
  try {
    if (origin) sameOrigin = new URL(origin).host === url.host;
    else if (referer) sameOrigin = new URL(referer).host === url.host;
  } catch (e) { sameOrigin = false; }
  if (!sameOrigin) return json({ error: 'forbidden' }, 403);

  const limiter = env.NEWSLETTER_RATE_LIMITER || env.SIGNIN_RATE_LIMITER;
  if (limiter) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    try { const { success } = await limiter.limit({ key: 'news:' + ip }); if (!success) return json({ error: 'rate_limited' }, 429); }
    catch (e) { /* limiter unavailable: fail open */ }
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, 400); }
  const email = ((body && body.email) || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return json({ error: 'invalid_email' }, 400);
  const cap = function (v, n) { return (typeof v === 'string' ? v : '').slice(0, n); };
  const stage = cap(body.stage, 32), source = cap(body.source, 200);
  const utmSource = cap(body.utmSource, 64), utmCampaign = cap(body.utmCampaign, 64);

  if (!env.NEWSLETTER_DB) return json({ error: 'server_config' }, 500);

  try {
    const emailHash = await sha256hex(email);
    const nowIso = new Date().toISOString();
    // Upsert: a new subscriber inserts; a re-subscribe refreshes the mutable fields but KEEPS the
    // original created_at + unsub_token, so any unsubscribe link already in someone's inbox stays valid.
    await env.NEWSLETTER_DB.prepare(
      'INSERT INTO subscribers (email_hash,email,stage,source,utm_source,utm_campaign,status,unsub_token,consent_at,created_at) '
      + "VALUES (?,?,?,?,?,?,'subscribed',?,?,?) "
      + 'ON CONFLICT(email_hash) DO UPDATE SET stage=excluded.stage, source=excluded.source, '
      + "utm_source=excluded.utm_source, utm_campaign=excluded.utm_campaign, status='subscribed', consent_at=excluded.consent_at"
    ).bind(emailHash, email, stage || 'unknown', source, utmSource, utmCampaign, crypto.randomUUID(), nowIso, nowIso).run();
    return json({ ok: true });
  } catch (e) {
    return json({ error: 'store_failed' }, 502);
  }
}

/* ---- Push reminders sender (Wave 5 Phase 2). The hourly cron reads each user's precomputed
   reminder index (users/{uid}.push.due, written by the client which owns the medicine logic) and
   sends due ones via FCM HTTP v1, reusing the same service-account OAuth (datastore + messaging
   scopes). Isolated from fetch(): a failure here only means a reminder did not fire, never a site
   or sign-in problem. ---- */
const FS_PROJECT = 'little-log-a9caa';
function _fsNum(v){ if(!v) return null; if(v.integerValue!=null) return +v.integerValue; if(v.doubleValue!=null) return +v.doubleValue; return null; }
function _fsStr(v){ return (v && v.stringValue!=null) ? v.stringValue : ''; }
function _inQuiet(hr, qs, qe){ if(qs==null||qe==null||qs===qe) return false; return qs<qe ? (hr>=qs&&hr<qe) : (hr>=qs||hr<qe); }
async function sendPushReminders(env){
  if(!env.FIREBASE_SERVICE_ACCOUNT) return;
  let sa; try{ sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); }catch(e){ return; }
  const token = await getAccessToken(sa, 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging');
  const base = 'https://firestore.googleapis.com/v1/projects/' + FS_PROJECT + '/databases/(default)/documents';
  const now = Date.now();
  let docs = [], pageToken = '';
  do {
    const r = await fetch(base + '/users?pageSize=300' + (pageToken ? ('&pageToken=' + encodeURIComponent(pageToken)) : ''), { headers: { authorization: 'Bearer ' + token } });
    if (!r.ok) break;
    const j = await r.json(); (j.documents || []).forEach(d => docs.push(d)); pageToken = j.nextPageToken || '';
  } while (pageToken);
  for (const d of docs) {
    try {
      const push = d.fields && d.fields.push && d.fields.push.mapValue && d.fields.push.mapValue.fields;
      if (!push || !(push.enabled && push.enabled.booleanValue)) continue;
      const tokensMap = push.tokens && push.tokens.mapValue && push.tokens.mapValue.fields;
      const tokens = tokensMap ? Object.keys(tokensMap) : [];
      if (!tokens.length) continue;
      const dueArr = (push.due && push.due.arrayValue && push.due.arrayValue.values) || [];
      const sentUpTo = _fsNum(push.sentUpTo) || 0;
      const todayKey = new Date(now).toISOString().slice(0, 10);
      if (_fsStr(push.lastPushDay) === todayKey) continue;   // HARD CAP: at most one push per user per day
      let maxAt = sentUpTo, pick = null;
      for (const v of dueArr) {
        const f = v.mapValue && v.mapValue.fields; if (!f) continue;
        const at = _fsNum(f.at); if (at == null || at <= sentUpTo || at > now) continue;
        if (at > maxAt) maxAt = at;
        if (!pick) pick = { title: _fsStr(f.title) || 'Cubby', body: _fsStr(f.body), tag: _fsStr(f.tag) || 'cubby' };
      }
      if (!pick) continue;                                   // nothing due -> no push at all
      for (const tk of tokens) {                             // ONE notification, to this user's devices
        await fetch('https://fcm.googleapis.com/v1/projects/' + FS_PROJECT + '/messages:send', {
          method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({ message: { token: tk, notification: { title: pick.title, body: pick.body }, data: { tag: pick.tag }, webpush: { fcmOptions: { link: 'https://little-cubby.com/app/' } } } })
        }).catch(() => {});
      }
      const id = d.name.split('/documents/users/')[1];
      if (id) await fetch(base + '/users/' + encodeURIComponent(id) + '?updateMask.fieldPaths=push.sentUpTo&updateMask.fieldPaths=push.lastPushDay', {
        method: 'PATCH', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ fields: { push: { mapValue: { fields: { sentUpTo: { integerValue: String(maxAt) }, lastPushDay: { stringValue: todayKey } } } } } })
      }).catch(() => {});
    } catch (e) { /* skip this user, keep going */ }
  }
}

export default {
  async scheduled(event, env) { try { await sendPushReminders(env); } catch (e) {} },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/send-signin-link') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      return sendSigninLink(request, env);
    }
    if (url.pathname === '/api/newsletter') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      return newsletterSignup(request, env);
    }
    if (url.pathname.startsWith('/__/')) {
      const upstream = new URL(url.pathname + url.search, 'https://little-log-a9caa.firebaseapp.com');
      return fetch(new Request(upstream, request));
    }
    return env.ASSETS.fetch(request);
  }
};
