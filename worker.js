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

/* POST /api/send-invite — email an invite link, from Cubby, on the owner's behalf.
   {idToken, token, email}
   Until now Cubby sent no invite email at all: submitInvite handed the owner a mailto: or a share
   sheet and she was the delivery mechanism. That is fine when she completes the share and silent
   when she does not, and the recipient never learns anything either way.
   AUTHENTICATED, deliberately and properly. It would have been easier to treat possession of the
   token as authorisation — the token is a secret, after all — but that turns this into an open
   relay: mint one link, then send Cubby-branded mail to any address, repeatedly. So the caller
   proves who they are with a real Firebase ID token, and we check against Firestore that they own
   the household the link points at. Three independent gates, then a send. */
async function sendInviteEmail(request, env, url) {
  if (env.SIGNIN_RATE_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    try {
      const { success } = await env.SIGNIN_RATE_LIMITER.limit({ key: 'inv:' + ip });
      if (!success) return json({ error: 'rate_limited' }, 429);
    } catch (e) { /* limiter unavailable: fail open, the auth check below still holds */ }
  }
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, 400); }
  const email = ((body && body.email) || '').trim().toLowerCase();
  const token = ((body && body.token) || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return json({ error: 'invalid_email' }, 400);
  if (!/^[A-Za-z0-9]{16,64}$/.test(token)) return json({ error: 'bad_request' }, 400);

  let auth; try { auth = await verifyFirebaseToken((body && body.idToken) || ''); }
  catch (e) { return json({ error: 'unauthorized' }, 401); }
  if (!auth || !auth.uid) return json({ error: 'unauthorized' }, 401);

  let sa; try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); } catch (e) { return json({ error: 'server_config' }, 500); }
  if (!env.RESEND_API_KEY) return json({ error: 'server_config' }, 500);

  try {
    const at = await getAccessToken(sa, 'https://www.googleapis.com/auth/datastore');
    const base = 'https://firestore.googleapis.com/v1/projects/' + FS_PROJECT + '/databases/(default)/documents';
    const hdr = { authorization: 'Bearer ' + at };

    const lr = await fetch(base + '/inviteLinks/' + encodeURIComponent(token), { headers: hdr });
    if (!lr.ok) return json({ error: 'no_link' }, 404);
    const lf = ((await lr.json()) || {}).fields || {};
    const hid = (lf.householdId || {}).stringValue || '';
    const used = (lf.usedBy || {}).stringValue || null;
    const expiresAt = (lf.expiresAt || {}).timestampValue || null;
    const byName = (lf.invitedByName || {}).stringValue || '';
    // Never email a link that cannot be walked through: the recipient would follow it into a dead
    // end and blame themselves.
    if (!hid || used) return json({ error: 'link_spent' }, 409);
    if (!expiresAt || Date.parse(expiresAt) < Date.now()) return json({ error: 'link_expired' }, 409);

    // The sender must actually own the household this link points at.
    const hr = await fetch(base + '/households/' + encodeURIComponent(hid), { headers: hdr });
    if (!hr.ok) return json({ error: 'unauthorized' }, 403);
    const members = ((((await hr.json()) || {}).fields || {}).members || {}).mapValue || {};
    const role = (((members.fields || {})[auth.uid] || {}).stringValue) || '';
    if (role !== 'owner') return json({ error: 'unauthorized' }, 403);

    // One send per token: a token is single-use anyway, so this caps the blast radius of the
    // endpoint at exactly one email per owner-authored Firestore write.
    const cache = caches.default;
    const once = new Request('https://cooldown.cubby.internal/inv/' + encodeURIComponent(token));
    if (await cache.match(once)) return json({ ok: true, cached: true });

    const link = url.origin + '/app/?join=' + token;
    // The inviter's name is user-supplied and goes into email HTML, so it is escaped here. There is
    // no esc() in this worker, and reaching for one that does not exist is how an injection ships.
    const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const who = byName ? (escHtml(byName) + ' has') : 'Someone has';
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.MAIL_FROM || 'Cubby <noreply@mail.little-cubby.com>',
        to: email,
        subject: 'You have been invited to a Cubby',
        // Deliberately says nothing about the baby: not a name, not a stage, nothing. An invite
        // lands in an inbox that may not be as private as the person sending it assumes.
        html: '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:440px;margin:0 auto;padding:28px 22px;color:#3a2f28">'
          + '<div style="font-size:40px">🐻</div>'
          + '<h1 style="font-family:Georgia,serif;font-size:23px;margin:12px 0 10px">' + who + ' invited you to their Cubby</h1>'
          + '<p style="font-size:15px;line-height:1.55;color:#6b615a">Cubby is where they keep the everyday things: feeds, naps, nappies, the next appointment. Opening this link puts you in their circle so you can see it as it happens, and add to it yourself.</p>'
          + '<p style="margin:22px 0"><a href="' + link + '" style="background:#C97FA0;color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:14px;display:inline-block">Join their Cubby</a></p>'
          + '<p style="font-size:13px;line-height:1.55;color:#8a7a6d">This link works once and only for a day, so it is just for you. If you were not expecting it, you can ignore it and nothing happens.</p>'
          + '</div>'
      })
    });
    if (!r.ok) return json({ error: 'send_failed' }, 502);
    await cache.put(once, new Response('1', { headers: { 'cache-control': 'max-age=86400' } }));
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
/* Firestore structured query over REST.
   This replaces the list-everything scans both cron jobs used to do. Paging `/users` and
   `/households` in full, 96 times a day, cost (every user + every household) in reads whether or not
   a single reminder was due — against Spark's 50k reads/day that capped the whole product at roughly
   260 users, and made the CRON the binding constraint on growth rather than the app.
   A range filter on ONE field is served by Firestore's automatic single-field index, so there is no
   composite index to author or deploy. Returns null (not []) when the query itself fails, so a
   caller can tell "nothing was due" apart from "we never found out". */
async function fsQuery(base, token, collectionId, fieldPath, op, value, limit, selectFields) {
  const sq = {
    from: [{ collectionId }],
    where: { fieldFilter: { field: { fieldPath }, op, value: { integerValue: String(value) } } },
    orderBy: [{ field: { fieldPath }, direction: 'ASCENDING' }],
    limit: limit || 300
  };
  if (selectFields) sq.select = { fields: selectFields.map(f => ({ fieldPath: f })) };
  const r = await fetch(base + ':runQuery', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: sq })
  }).catch(e => { console.error('fs_query_throw', collectionId, (e && e.message) || String(e)); return null; });
  if (!r) return { docs: null, error: 'throw' };
  if (!r.ok) {
    // Log the whole body (it names the exact cause, e.g. a FAILED_PRECONDITION missing-index link)
    // but return only the status: /api/health is PUBLIC, so it must not carry Firestore internals.
    const body = await r.text().catch(() => '');
    console.error('fs_query_fail', collectionId, r.status, body.slice(0, 500));
    return { docs: null, error: String(r.status) };
  }
  const j = await r.json().catch(() => null);
  if (!Array.isArray(j)) { console.error('fs_query_shape', collectionId); return { docs: null, error: 'shape' }; }
  return { docs: j.map(e => e && e.document).filter(Boolean), error: null };
}
/* Page a whole collection. This is the thing the queries above exist to avoid, kept for exactly two
   callers: the one-time nextAt backfill, and the push fallback below. */
async function fsPageAll(base, token, path, mask) {
  let out = [], pageToken = '';
  do {
    const r = await fetch(base + '/' + path + '?pageSize=300' + (mask ? ('&mask.fieldPaths=' + mask) : '')
      + (pageToken ? ('&pageToken=' + encodeURIComponent(pageToken)) : ''), { headers: { authorization: 'Bearer ' + token } });
    if (!r.ok) { console.error('fs_page_fail', path, r.status); return null; }
    const j = await r.json();
    (j.documents || []).forEach(d => out.push(d));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}
/* One-time backfill. Anyone who enabled push BEFORE nextAt existed has a valid push.due and no
   nextAt, so the new query would not see them and their medicine reminders would stop silently.
   Push is critical-only (medicine), so a missed one is the worst outcome this file can produce.
   Pages /users ONCE, fills in nextAt where it is missing, then records that in D1 and never scans
   again. A fetch failure returns WITHOUT marking it done, so it retries on the next tick.
   This is the only full-collection scan left in the Worker and it runs at most once. */
async function backfillPushNextAt(env, base, token) {
  if (!env.GAMES_DB) return;
  try {
    await env.GAMES_DB.prepare("CREATE TABLE IF NOT EXISTS ops_state (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)").run();
    const done = await env.GAMES_DB.prepare("SELECT value FROM ops_state WHERE key='push_nextat_backfill'").first();
    if (done && done.value) return;
    let pageToken = '', fixed = 0, seen = 0;
    do {
      const r = await fetch(base + '/users?pageSize=300' + (pageToken ? ('&pageToken=' + encodeURIComponent(pageToken)) : ''), { headers: { authorization: 'Bearer ' + token } });
      if (!r.ok) { console.error('backfill_fetch_fail', r.status); return; }
      const j = await r.json();
      for (const d of (j.documents || [])) {
        seen++;
        const push = d.fields && d.fields.push && d.fields.push.mapValue && d.fields.push.mapValue.fields;
        if (!push || _fsNum(push.nextAt) != null) continue;
        const dueArr = (push.due && push.due.arrayValue && push.due.arrayValue.values) || [];
        const sentUpTo = _fsNum(push.sentUpTo) || 0;
        let nextAt = null;
        for (const v of dueArr) {
          const f = v.mapValue && v.mapValue.fields; const at = f && _fsNum(f.at);
          if (at != null && at > sentUpTo && (nextAt == null || at < nextAt)) nextAt = at;
        }
        const id = nextAt == null ? '' : d.name.split('/documents/users/')[1];
        if (!id) continue;
        await fetch(base + '/users/' + encodeURIComponent(id) + '?updateMask.fieldPaths=push.nextAt', {
          method: 'PATCH', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({ fields: { push: { mapValue: { fields: { nextAt: { integerValue: String(nextAt) } } } } } })
        }).catch(e => console.error('backfill_patch_fail', (e && e.message) || String(e)));
        fixed++;
      }
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    await env.GAMES_DB.prepare("INSERT INTO ops_state(key,value,updated_at) VALUES('push_nextat_backfill',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
      .bind(JSON.stringify({ seen, fixed }), Date.now()).run();
    console.log('backfill_push_nextat', JSON.stringify({ seen, fixed }));
  } catch (e) { console.error('backfill_fail', (e && e.message) || String(e)); }
}
/* Drop `push.nextAt` so this user stops matching the cron's query. Naming the path in the updateMask
   while omitting it from the body is how Firestore REST deletes a field. */
async function clearPushNextAt(base, token, id) {
  return fetch(base + '/users/' + encodeURIComponent(id) + '?updateMask.fieldPaths=push.nextAt', {
    method: 'PATCH', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { push: { mapValue: { fields: {} } } } })
  }).catch(e => console.error('push_clear_nextat_fail', (e && e.message) || String(e)));
}
async function sendPushReminders(env){
  if(!env.FIREBASE_SERVICE_ACCOUNT) return;
  let sa; try{ sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); }catch(e){ return; }
  const token = await getAccessToken(sa, 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging');
  const base = 'https://firestore.googleapis.com/v1/projects/' + FS_PROJECT + '/databases/(default)/documents';
  const now = Date.now();
  let sent = 0, userErrors = 0, failed = 0, dropped = 0;
  await backfillPushNextAt(env, base, token);
  // Only the users with something actually due. `push.nextAt` is the earliest unsent fire time,
  // written by the client alongside push.due and kept honest below. Users who have never enabled
  // push have no nextAt at all, so they are not in the index and cost nothing.
  const q = await fsQuery(base, token, 'users', 'push.nextAt', 'LESS_THAN_OR_EQUAL', now, 500);
  let docs = q.docs, queryError = q.error;
  if (!docs) {
    // The query is the OPTIMISATION, not the feature. Push is critical-only (medicine), so if the
    // query fails for any reason we fall back to the old full page rather than silently sending
    // nothing. Expensive, and deliberately loud: the status shows up at /api/health so a degraded
    // cron cannot sit unnoticed the way a missing reminder would.
    docs = await fsPageAll(base, token, 'users');
    if (!docs) { await recordCronRun(env, { due: 0, sent: 0, failed: 0, dropped: 0, userErrors: 0, queryError, fallback: 'failed' }); return; }
  }
  for (const d of docs) {
    try {
      const id = d.name.split('/documents/users/')[1];
      const push = d.fields && d.fields.push && d.fields.push.mapValue && d.fields.push.mapValue.fields;
      const tokensMap = push && push.tokens && push.tokens.mapValue && push.tokens.mapValue.fields;
      const tokens = tokensMap ? Object.keys(tokensMap) : [];
      // Matched the query but cannot be delivered to. Clear nextAt or this doc is re-read on every
      // run forever (96 wasted reads/day each) — the exact failure mode this change exists to remove.
      // Only when nextAt is actually SET: on the fallback path `docs` is every user in the project,
      // and an unguarded clear would PATCH every one of them on every tick.
      if (!push || !(push.enabled && push.enabled.booleanValue) || !tokens.length) {
        if (id && _fsNum(push && push.nextAt) != null) await clearPushNextAt(base, token, id);
        continue;
      }
      const dueArr = (push.due && push.due.arrayValue && push.due.arrayValue.values) || [];
      const sentUpTo = _fsNum(push.sentUpTo) || 0;
      /* Plan first, in fire order, then send. The cursor may only pass a message we are DONE with,
         and "done" is two things, never three:
           delivered  - at least one token accepted it
           dropped    - we deliberately chose not to send it (too late to be useful)
         A message we TRIED and failed to deliver is not done. It used to be: maxAt advanced here in
         the planning loop and sentUpTo was PATCHed regardless of what FCM said, so one transient 429
         or 503 (or the network throw caught below) consumed a dose reminder for good and no retry was
         possible, because from the cursor's point of view it had been sent. That is the same shape as
         the fsDeleteAll bug in the purge path: a failure read as "nothing to do".
         NEVER after still holds: a dose reminder carries its dose time, and once that has passed we
         drop it rather than nudge someone toward a dose they should no longer take. The digest (no
         due) is dropped once stale so a long-closed app never bursts. Both are DROPS, which do
         advance the cursor, and both are now counted so they are visible instead of invisible. */
      const plan = [];
      for (const v of dueArr) {
        const f = v.mapValue && v.mapValue.fields; if (!f) continue;
        const at = _fsNum(f.at); if (at == null || at <= sentUpTo || at > now) continue;
        const due = _fsNum(f.due);
        const stale = due != null ? (now > due) : (at < now - 20 * 60000);
        plan.push({ at, drop: stale, title: _fsStr(f.title) || 'Cubby', body: _fsStr(f.body), tag: _fsStr(f.tag) || 'cubby' });
      }
      plan.sort((a, b) => a.at - b.at);

      let maxAt = sentUpTo, stuck = false;
      for (const msg of plan) {
        if (msg.drop) { dropped++; if (!stuck) maxAt = msg.at; continue; }
        let anyOk = false;
        for (const tk of tokens) {
          const fcmOk = await fetch('https://fcm.googleapis.com/v1/projects/' + FS_PROJECT + '/messages:send', {
            method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
            body: JSON.stringify({ message: { token: tk, notification: { title: msg.title, body: msg.body }, data: { tag: msg.tag }, webpush: { fcmOptions: { link: 'https://little-cubby.com/app/' } } } })
          }).then(r => r.ok).catch(e => { console.error('push_fcm_fail', (e && e.message) || String(e)); return false; });
          if (fcmOk) { anyOk = true; sent++; }
        }
        if (anyOk) { if (!stuck) maxAt = msg.at; }
        // Freeze the cursor at the first undelivered message so the next tick retries from exactly
        // here. Later messages are still attempted (a single bad payload must not block the queue
        // behind it), but they stay behind the cursor and may repeat once; the FCM `tag` collapses a
        // repeat in the OS notification centre rather than stacking a second one.
        else { failed++; stuck = true; }
      }
      // Advance the send cursor and the query key together. nextAt = the earliest fire time still
      // unsent, and it is CLEARED rather than nulled when nothing is left, so the doc drops out of
      // the single-field index entirely instead of merely failing to match (test/push-query.test.js).
      let nextAt = null;
      for (const v of dueArr) {
        const f = v.mapValue && v.mapValue.fields; const at = f && _fsNum(f.at);
        if (at != null && at > maxAt && (nextAt == null || at < nextAt)) nextAt = at;
      }
      if (id && (maxAt > sentUpTo || nextAt !== _fsNum(push.nextAt))) {
        const fields = { sentUpTo: { integerValue: String(maxAt) } };
        if (nextAt != null) fields.nextAt = { integerValue: String(nextAt) };
        await fetch(base + '/users/' + encodeURIComponent(id) + '?updateMask.fieldPaths=push.sentUpTo&updateMask.fieldPaths=push.nextAt', {
          method: 'PATCH', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({ fields: { push: { mapValue: { fields } } } })
        }).catch(e => console.error('push_sentupto_fail', (e && e.message) || String(e)));
      }
    } catch (e) { userErrors++; console.error('push_user_fail', (e && e.message) || String(e)); }
  }
  console.log('push_run', JSON.stringify({ due: docs.length, sent, failed, dropped, userErrors, queryError }));
  await recordCronRun(env, queryError ? { due: docs.length, sent, failed, dropped, userErrors, queryError, fallback: 'scan' }
                                      : { due: docs.length, sent, failed, dropped, userErrors });
}
/* ---- Account deletion, second half (App Store 5.1.1(v)).
   When the LAST member deletes their account the client cannot erase the household: it would have to
   delete subcollections it is no longer a member of, and Firestore has no recursive delete from a
   browser anyway. So the client flags the doc with `deleteAfter` (+30 days) and this runs on the
   existing 15-minute cron with the service account, which bypasses rules.

   The 30 days is a grace window, not retention — it exists so a mistaken tap is recoverable, and
   privacy/index.html states it. Once it lapses the household goes completely: every subcollection
   first, then the doc itself, so a crash mid-purge can never leave a household doc that looks alive
   but has been gutted. ---- */
const HH_SUBCOLLECTIONS = ['events', 'photos', 'notes', 'pregnancy'];
/* Returns the number deleted, or NULL if anything at all went wrong.
   Null matters: the caller deletes the household doc only after every subcollection is gone. This
   used to return the running count on a failed listing and merely log a failed DELETE, so a 403 or a
   500 read as "0 documents, nothing to do" and the parent was deleted anyway — orphaning every
   remaining child for ever (unreachable, because rules key off membership, but still stored) and
   destroying the retry, since `deleteAfter` went with the parent. On the A6 deletion path those are
   documents someone ASKED to have erased, so a silent partial delete is a privacy failure that
   reports itself as success. A 404 is different and still counts as fine: the collection simply
   never existed. */
async function fsDeleteAll(base, token, path) {
  // Firestore REST has no recursive delete; page the ids and delete them one by one.
  let n = 0, pageToken = '';
  do {
    const url = base + '/' + path + '?pageSize=300&mask.fieldPaths=__name__'
      + (pageToken ? ('&pageToken=' + encodeURIComponent(pageToken)) : '');
    const r = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
    if (!r.ok) {
      if (r.status === 404) return n;
      console.error('purge_list_fail', path, r.status);
      return null;
    }
    const j = await r.json().catch(() => null);
    if (!j) { console.error('purge_list_shape', path); return null; }
    for (const d of (j.documents || [])) {
      const del = await fetch('https://firestore.googleapis.com/v1/' + d.name, {
        method: 'DELETE', headers: { authorization: 'Bearer ' + token }
      });
      if (del.ok) { n++; continue; }
      console.error('purge_del_fail', d.name, del.status);
      return null;
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return n;
}
async function purgeDeletedHouseholds(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return { households: 0, docs: 0 };
  let sa; try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); } catch (e) { return { households: 0, docs: 0 }; }
  const token = await getAccessToken(sa, 'https://www.googleapis.com/auth/datastore');
  const base = 'https://firestore.googleapis.com/v1/projects/' + FS_PROJECT + '/databases/(default)/documents';
  const now = Date.now();
  let households = 0, docs = 0;
  // Only households whose grace window has actually lapsed. A household that was never flagged has
  // no `deleteAfter` field, so it is absent from the index and is never read. Capped per run because
  // each hit fans out into subcollection deletes; the 15-minute cron picks up the rest.
  {
    // No fallback here on purpose: a 30-day grace window can wait for the next tick, and a full
    // /households scan is the expensive one. A failure is logged and retried, never scanned around.
    const found = (await fsQuery(base, token, 'households', 'deleteAfter', 'LESS_THAN_OR_EQUAL', now, 50, ['deleteAfter'])).docs;
    if (!found) return { households: 0, docs: 0 };
    for (const d of found) {
      const hid = d.name.split('/documents/households/')[1];
      if (!hid) continue;
      try {
        // Every child must be confirmed gone before the parent goes. Any failure abandons THIS
        // household untouched: `deleteAfter` stays set, so the next tick retries the whole thing.
        // Partial progress is safe to repeat; a deleted parent is not.
        let complete = true;
        for (const sub of HH_SUBCOLLECTIONS) {
          const n = await fsDeleteAll(base, token, 'households/' + hid + '/' + sub);
          if (n === null) { complete = false; break; }
          docs += n;
        }
        // mhealth is nested one level deeper: mhealth/{uid}/cat/{category}.
        if (complete) {
          const mh = await fetch(base + '/households/' + hid + '/mhealth?pageSize=300&mask.fieldPaths=__name__', { headers: { authorization: 'Bearer ' + token } });
          if (mh.ok) {
            const mj = await mh.json().catch(() => null);
            if (!mj) complete = false;
            for (const owner of ((mj && mj.documents) || [])) {
              const ouid = owner.name.split('/mhealth/')[1];
              if (!ouid) continue;
              const n = await fsDeleteAll(base, token, 'households/' + hid + '/mhealth/' + ouid + '/cat');
              if (n === null) { complete = false; break; }
              docs += n;
            }
          } else if (mh.status !== 404) { console.error('purge_mhealth_list_fail', hid, mh.status); complete = false; }
        }
        if (!complete) { console.error('purge_hh_incomplete', hid); continue; }
        // The household doc LAST, so an interrupted run retries rather than orphaning subcollections.
        const delHh = await fetch(base + '/households/' + hid, { method: 'DELETE', headers: { authorization: 'Bearer ' + token } });
        if (delHh.ok) { households++; docs++; } else console.error('purge_hh_del_fail', hid, delHh.status);
      } catch (e) { console.error('purge_hh_fail', hid, (e && e.message) || String(e)); }
    }
  }
  if (households) console.log('purge_run', JSON.stringify({ households, docs }));
  return { households, docs };
}

// Operational heartbeat for the push cron: persist last-run summary in the Worker's own D1 (cubby-games),
// read by GET /api/health so a silently-dead cron is detectable. Holds counts + a timestamp only, never
// any family / Firestore data.
async function recordCronRun(env, summary) {
  if (!env.GAMES_DB) return;
  try {
    await env.GAMES_DB.prepare("CREATE TABLE IF NOT EXISTS ops_state (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)").run();
    await env.GAMES_DB.prepare("INSERT INTO ops_state(key,value,updated_at) VALUES('push_last_run',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
      .bind(JSON.stringify(summary || {}), Date.now()).run();
  } catch (e) { console.error('ops_state_write_fail', (e && e.message) || String(e)); }
}

// Deletes the D1 rows tied to one Firebase uid. Firestore rules cannot see D1, so without this a
// deleted account would leave its guessing-game hubs (and every guest's nickname and guess) behind.
// Same cascade order as the hub-close path: children first, then the hub row.
async function purgeAccountData(request, env) {
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, 400); }
  let auth; try { auth = await verifyFirebaseToken((body && body.idToken) || ''); }
  catch (e) { return json({ error: 'unauthorized' }, 401); }
  if (!auth || !auth.uid) return json({ error: 'unauthorized' }, 401);
  if (!env.GAMES_DB) return json({ ok: true, hubs: 0 });
  try {
    // A user who never hosted a game hits this before the tables exist; creating them is cheaper
    // than letting a missing table read as a failed deletion.
    await ensureHubSchema(env);
    const owned = await env.GAMES_DB.prepare('SELECT code FROM hubs WHERE owner_uid=?').bind(auth.uid).all();
    const codes = ((owned && owned.results) || []).map(r => r.code);
    for (const code of codes) {
      await env.GAMES_DB.prepare('DELETE FROM hub_guesses WHERE hub_code=?').bind(code).run();
      await env.GAMES_DB.prepare('DELETE FROM hub_games WHERE hub_code=?').bind(code).run();
      await env.GAMES_DB.prepare('DELETE FROM hubs WHERE code=?').bind(code).run();
    }
    return json({ ok: true, hubs: codes.length });
  } catch (e) {
    console.error('purge_account_fail', (e && e.message) || String(e));
    return json({ error: 'db_error' }, 500);
  }
}

// ---- Boy-or-girl guessing game (hosted, guests need no account). ISOLATED in cubby-games D1. ----
function gameCode(n) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789'; const arr = new Uint8Array(n); crypto.getRandomValues(arr);
  let s = ''; for (let i = 0; i < n; i++) s += a[arr[i] % a.length]; return s;
}
async function gameState(code, env) {
  const g = await env.GAMES_DB.prepare('SELECT title,result,status FROM games WHERE code=?').bind(code).first();
  if (!g) return json({ error: 'not_found' }, 404);
  const rows = ((await env.GAMES_DB.prepare('SELECT nickname,guess,note FROM guesses WHERE code=? ORDER BY created_at').bind(code).all()).results) || [];
  const tally = { F: rows.filter(r => r.guess === 'F').length, M: rows.filter(r => r.guess === 'M').length };
  return json({ title: g.title, status: g.status, result: g.result || '', tally, guesses: rows });
}
async function ensureGamesSchema(env) {
  // Idempotent: lets a freshly-created (empty) cubby-games D1 work without a manual schema step.
  await env.GAMES_DB.prepare("CREATE TABLE IF NOT EXISTS games (code TEXT PRIMARY KEY, title TEXT, host_key TEXT, result TEXT DEFAULT '', status TEXT DEFAULT 'open', created_at INTEGER)").run();
  await env.GAMES_DB.prepare("CREATE TABLE IF NOT EXISTS guesses (id TEXT PRIMARY KEY, code TEXT, nickname TEXT, guess TEXT, note TEXT, created_at INTEGER)").run();
  await env.GAMES_DB.prepare("CREATE INDEX IF NOT EXISTS idx_guesses_code ON guesses(code)").run();
}
async function gameRateLimited(request, env, bucket) {
  const limiter = env.GAMES_RATE_LIMITER || env.SIGNIN_RATE_LIMITER;
  if (!limiter) return false;
  const ip = request.headers.get('cf-connecting-ip') || '?';
  try { const { success } = await limiter.limit({ key: bucket + ':' + ip }); return !success; }
  catch (e) { return false; }
}
async function gameRoute(request, env, url) {
  if (!env.GAMES_DB) return json({ error: 'server_config' }, 500);   // dormant until the D1 is provisioned
  try {
  const parts = url.pathname.split('/').filter(Boolean); // ['api','game',code?,action?]
  const method = request.method;
  if (parts.length === 3 && parts[2] === 'create' && method === 'POST') {
    if (await gameRateLimited(request, env, 'gcreate')) return json({ error: 'rate_limited' }, 429);
    await ensureGamesSchema(env);
    const b = await request.json().catch(() => ({}));
    const title = (b.title || 'Our baby').toString().trim().slice(0, 40) || 'Our baby';
    const code = gameCode(8), hostKey = gameCode(20), at = Date.now();
    await env.GAMES_DB.prepare('INSERT INTO games(code,title,host_key,result,status,created_at) VALUES(?,?,?,?,?,?)').bind(code, title, hostKey, '', 'open', at).run();
    return json({ code, hostKey, title });
  }
  const code = parts[2];
  if (!code || !/^[a-z0-9]{4,16}$/.test(code)) return json({ error: 'bad_code' }, 400);
  const action = parts[3];
  if (action === 'guess' && method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || '?';
    const limiter = env.GAMES_RATE_LIMITER || env.SIGNIN_RATE_LIMITER;
    if (limiter) { try { const { success } = await limiter.limit({ key: 'game:' + ip }); if (!success) return json({ error: 'rate_limited' }, 429); } catch (e) {} }
    const g = await env.GAMES_DB.prepare('SELECT status FROM games WHERE code=?').bind(code).first();
    if (!g) return json({ error: 'not_found' }, 404);
    if (g.status !== 'open') return json({ error: 'closed' }, 409);
    const b = await request.json().catch(() => ({}));
    const nickname = (b.nickname || '').toString().trim().slice(0, 30);
    const guess = (b.guess || '').toString();
    const note = (b.note || '').toString().trim().slice(0, 80);
    if (!nickname || (guess !== 'F' && guess !== 'M')) return json({ error: 'bad_input' }, 400);
    const c = await env.GAMES_DB.prepare('SELECT COUNT(*) n FROM guesses WHERE code=?').bind(code).first();
    if (c && c.n >= 300) return json({ error: 'full' }, 409);
    await env.GAMES_DB.prepare('INSERT INTO guesses(id,code,nickname,guess,note,created_at) VALUES(?,?,?,?,?,?)').bind(gameCode(12), code, nickname, guess, note, Date.now()).run();
    return gameState(code, env);
  }
  if (action === 'reveal' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const g = await env.GAMES_DB.prepare('SELECT host_key FROM games WHERE code=?').bind(code).first();
    if (!g) return json({ error: 'not_found' }, 404);
    if (!b.hostKey || b.hostKey !== g.host_key) return json({ error: 'forbidden' }, 403);
    const result = (b.result || '').toString();
    if (['F', 'M', 'MF', 'FF', 'MM', ''].indexOf(result) < 0) return json({ error: 'bad_result' }, 400);
    await env.GAMES_DB.prepare('UPDATE games SET result=?, status=? WHERE code=?').bind(result, result ? 'revealed' : 'open', code).run();
    return gameState(code, env);
  }
  if (!action && method === 'GET') {
    if (await gameRateLimited(request, env, 'gget')) return json({ error: 'rate_limited' }, 429);
    return gameState(code, env);
  }
  return json({ error: 'not_found' }, 404);
  } catch (e) {
    console.error('games_db_error', (e && e.message) || String(e));
    return json({ error: 'db_error' }, 500);
  }
}

/* ---- Games Hub (Phase 1): one shareable space per pregnancy hosting several guest games.
   Guests still need NO account (join + guess are open + rate-limited). Ownership of a hub is
   proven by the host's Firebase identity — create + reveal require a verified Firebase ID token,
   so no secret key is ever synced to Firestore. ISOLATED in the cubby-games D1 alongside the
   legacy single-game tables, which are left untouched so old /g/<gameCode> links keep working. ---- */

function bearer(request) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}
function _b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function _b64urlToStr(s) { return new TextDecoder().decode(_b64urlToBytes(s)); }

// Google's public signing keys (JWK), cached in-isolate per the response's max-age.
let _fbJwk = { keys: null, exp: 0 };
async function getFirebaseJWKs() {
  const now = Date.now();
  if (_fbJwk.keys && now < _fbJwk.exp) return _fbJwk.keys;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!r.ok) throw new Error('jwk_fetch_' + r.status);
  const j = await r.json();
  const cc = r.headers.get('cache-control') || '';
  const m = cc.match(/max-age=(\d+)/);
  const ttl = m ? parseInt(m[1], 10) * 1000 : 3600000;
  const map = {};
  (j.keys || []).forEach(k => { if (k.kid) map[k.kid] = k; });
  _fbJwk = { keys: map, exp: now + ttl };
  return map;
}
// Verify a Firebase ID token (RS256) the manual way: signature against Google's JWK, then the
// standard exp/iat/aud/iss/sub claims for our project. Returns { uid, email } or throws.
async function verifyFirebaseToken(idToken) {
  if (!idToken || typeof idToken !== 'string') throw new Error('no_token');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('bad_token');
  const header = JSON.parse(_b64urlToStr(parts[0]));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('bad_alg');
  const jwks = await getFirebaseJWKs();
  const jwk = jwks[header.kid];
  if (!jwk) throw new Error('unknown_kid');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const ok = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, _b64urlToBytes(parts[2]), data);
  if (!ok) throw new Error('bad_sig');
  const p = JSON.parse(_b64urlToStr(parts[1]));
  const now = Math.floor(Date.now() / 1000), skew = 60;
  if (p.exp == null || p.exp + skew < now) throw new Error('expired');
  if (p.iat == null || p.iat - skew > now) throw new Error('future_iat');
  if (p.aud !== FS_PROJECT) throw new Error('bad_aud');
  if (p.iss !== 'https://securetoken.google.com/' + FS_PROJECT) throw new Error('bad_iss');
  if (!p.sub) throw new Error('no_sub');
  return { uid: p.sub, email: p.email || '' };
}

async function ensureHubSchema(env) {
  await env.GAMES_DB.prepare("CREATE TABLE IF NOT EXISTS hubs (code TEXT PRIMARY KEY, owner_uid TEXT, title TEXT, created_at INTEGER)").run();
  await env.GAMES_DB.prepare("CREATE TABLE IF NOT EXISTS hub_games (id TEXT PRIMARY KEY, hub_code TEXT, type TEXT, prompt TEXT, status TEXT DEFAULT 'open', result TEXT DEFAULT '', created_at INTEGER)").run();
  await env.GAMES_DB.prepare("CREATE TABLE IF NOT EXISTS hub_guesses (id TEXT PRIMARY KEY, game_id TEXT, hub_code TEXT, nickname TEXT, guess TEXT, note TEXT, relation TEXT, created_at INTEGER)").run();
  try { await env.GAMES_DB.prepare("ALTER TABLE hub_guesses ADD COLUMN relation TEXT").run(); } catch (e) {} // add 'relation' to tables created before it existed
  await env.GAMES_DB.prepare("CREATE INDEX IF NOT EXISTS idx_hubgames_hub ON hub_games(hub_code)").run();
  await env.GAMES_DB.prepare("CREATE INDEX IF NOT EXISTS idx_hubguesses_game ON hub_guesses(game_id)").run();
}

function _ddNum(v, max) { const n = Number(v); if (!isFinite(n) || n < 0 || n > max) return null; return Math.round(n); }
function _ddObj(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = (raw.date || '').toString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const o = { date };
  if (raw.weightG != null) { const w = _ddNum(raw.weightG, 8000); if (w != null) o.weightG = w; }
  if (raw.lengthCm != null) { const l = _ddNum(raw.lengthCm, 80); if (l != null) o.lengthCm = l; }
  if (raw.timeOfDay != null) { const t = raw.timeOfDay.toString().trim().slice(0, 20); if (t) o.timeOfDay = t; }
  return o;
}
// A guess/result is shaped by its game type. 'sex' -> 'F'/'M' (guess) or 'F'/'M'/'MF'/'FF'/'MM'/''
// (result); 'duedate' -> a JSON string {date, weightG?, lengthCm?, timeOfDay?}. null = invalid.
function normalizeGuess(type, raw) {
  if (type === 'sex') { const g = (raw || '').toString(); return (g === 'F' || g === 'M') ? g : null; }
  if (type === 'duedate') { const o = _ddObj(raw); return o ? JSON.stringify(o) : null; }
  return null;
}
function normalizeResult(type, raw) {
  if (type === 'sex') { const r = (raw || '').toString(); return (['F', 'M', 'MF', 'FF', 'MM', ''].indexOf(r) >= 0) ? r : null; }
  if (type === 'duedate') { if (raw === '' || raw == null) return ''; const o = _ddObj(raw); return o ? JSON.stringify(o) : null; }
  return null;
}

async function hubState(code, env) {
  let hub;
  try { hub = await env.GAMES_DB.prepare('SELECT title FROM hubs WHERE code=?').bind(code).first(); }
  catch (e) { await ensureHubSchema(env); hub = await env.GAMES_DB.prepare('SELECT title FROM hubs WHERE code=?').bind(code).first(); } // self-heal on a fresh D1
  if (!hub) return json({ error: 'not_found' }, 404);
  const games = ((await env.GAMES_DB.prepare('SELECT id,type,prompt,status,result FROM hub_games WHERE hub_code=? ORDER BY created_at').bind(code).all()).results) || [];
  const out = [];
  for (const g of games) {
    const rows = ((await env.GAMES_DB.prepare('SELECT nickname,guess,note,relation FROM hub_guesses WHERE game_id=? ORDER BY created_at').bind(g.id).all()).results) || [];
    out.push({ id: g.id, type: g.type, prompt: g.prompt || '', status: g.status, result: g.result || '', count: rows.length, guesses: rows });
  }
  // owner_uid is intentionally NOT returned: guests must never see who owns the hub.
  return json({ title: hub.title, games: out });
}

async function hubRoute(request, env, url) {
  if (!env.GAMES_DB) return json({ error: 'server_config' }, 500);   // dormant until the D1 is provisioned
  try {
    const parts = url.pathname.split('/').filter(Boolean); // ['api','hub',code?,...]
    const method = request.method;

    // POST /api/hub/create  (auth) -> create a hub with its default games
    if (parts.length === 3 && parts[2] === 'create' && method === 'POST') {
      if (await gameRateLimited(request, env, 'hcreate')) return json({ error: 'rate_limited' }, 429);
      let auth; try { auth = await verifyFirebaseToken(bearer(request)); } catch (e) { console.error('hub_auth_fail', (e && e.message) || String(e)); return json({ error: 'unauthorized' }, 401); }
      await ensureHubSchema(env);
      const b = await request.json().catch(() => ({}));
      const title = (b.title || 'Our baby').toString().trim().slice(0, 40) || 'Our baby';
      const reqGames = Array.isArray(b.games) && b.games.length ? b.games.slice(0, 6) : [{ type: 'sex' }, { type: 'duedate' }];
      const code = gameCode(8), at = Date.now();
      await env.GAMES_DB.prepare('INSERT INTO hubs(code,owner_uid,title,created_at) VALUES(?,?,?,?)').bind(code, auth.uid, title, at).run();
      const created = [];
      for (const g of reqGames) {
        const type = (g && g.type === 'duedate') ? 'duedate' : 'sex';
        const prompt = (g && g.prompt ? g.prompt : '').toString().slice(0, 120);
        const gid = gameCode(10);
        await env.GAMES_DB.prepare('INSERT INTO hub_games(id,hub_code,type,prompt,status,result,created_at) VALUES(?,?,?,?,?,?,?)').bind(gid, code, type, prompt, 'open', '', at).run();
        created.push({ id: gid, type });
      }
      return json({ hubCode: code, title, games: created });
    }

    const code = parts[2];
    if (!code || !/^[a-z0-9]{4,16}$/.test(code)) return json({ error: 'bad_code' }, 400);

    // GET /api/hub/:code -> public hub state
    if (parts.length === 3 && method === 'GET') {
      if (await gameRateLimited(request, env, 'hget')) return json({ error: 'rate_limited' }, 429);
      return hubState(code, env);
    }

    // POST /api/hub/:code/guess -> a guest submits a guess (open, no account)
    if (parts.length === 4 && parts[3] === 'guess' && method === 'POST') {
      if (await gameRateLimited(request, env, 'hguess')) return json({ error: 'rate_limited' }, 429);
      const b = await request.json().catch(() => ({}));
      const gameId = (b.gameId || '').toString();
      const nickname = (b.nickname || '').toString().trim().slice(0, 30);
      if (!nickname) return json({ error: 'bad_input' }, 400);
      const g = await env.GAMES_DB.prepare('SELECT id,type,status FROM hub_games WHERE id=? AND hub_code=?').bind(gameId, code).first();
      if (!g) return json({ error: 'not_found' }, 404);
      if (g.status !== 'open') return json({ error: 'closed' }, 409);
      const guess = normalizeGuess(g.type, b.guess);
      if (guess == null) return json({ error: 'bad_input' }, 400);
      const note = (b.note || '').toString().trim().slice(0, 80);
      const relation = (b.relation || '').toString().trim().slice(0, 24);
      const c = await env.GAMES_DB.prepare('SELECT COUNT(*) n FROM hub_guesses WHERE game_id=?').bind(gameId).first();
      if (c && c.n >= 300) return json({ error: 'full' }, 409);
      await env.GAMES_DB.prepare('INSERT INTO hub_guesses(id,game_id,hub_code,nickname,guess,note,relation,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(gameCode(12), gameId, code, nickname, guess, note, relation, Date.now()).run();
      return hubState(code, env);
    }

    // POST /api/hub/:code/game/:id/reveal  (auth, owner only)
    if (parts.length === 6 && parts[3] === 'game' && parts[5] === 'reveal' && method === 'POST') {
      if (await gameRateLimited(request, env, 'hreveal')) return json({ error: 'rate_limited' }, 429);
      let auth; try { auth = await verifyFirebaseToken(bearer(request)); } catch (e) { console.error('hub_auth_fail', (e && e.message) || String(e)); return json({ error: 'unauthorized' }, 401); }
      const hub = await env.GAMES_DB.prepare('SELECT owner_uid FROM hubs WHERE code=?').bind(code).first();
      if (!hub) return json({ error: 'not_found' }, 404);
      if (hub.owner_uid !== auth.uid) return json({ error: 'forbidden' }, 403);
      const gameId = parts[4];
      const g = await env.GAMES_DB.prepare('SELECT type FROM hub_games WHERE id=? AND hub_code=?').bind(gameId, code).first();
      if (!g) return json({ error: 'not_found' }, 404);
      const b = await request.json().catch(() => ({}));
      const result = normalizeResult(g.type, b.result);
      if (result == null) return json({ error: 'bad_result' }, 400);
      await env.GAMES_DB.prepare('UPDATE hub_games SET result=?, status=? WHERE id=? AND hub_code=?').bind(result, result ? 'revealed' : 'open', gameId, code).run();
      return hubState(code, env);
    }

    // POST /api/hub/:code/close  (auth, owner only) -> retire the hub on a pregnancy loss/end or data delete
    if (parts.length === 4 && parts[3] === 'close' && method === 'POST') {
      if (await gameRateLimited(request, env, 'hclose')) return json({ error: 'rate_limited' }, 429);
      let auth; try { auth = await verifyFirebaseToken(bearer(request)); } catch (e) { console.error('hub_auth_fail', (e && e.message) || String(e)); return json({ error: 'unauthorized' }, 401); }
      const hub = await env.GAMES_DB.prepare('SELECT owner_uid FROM hubs WHERE code=?').bind(code).first();
      if (!hub) return json({ ok: true });   // already gone
      if (hub.owner_uid !== auth.uid) return json({ error: 'forbidden' }, 403);
      await env.GAMES_DB.prepare('DELETE FROM hub_guesses WHERE hub_code=?').bind(code).run();
      await env.GAMES_DB.prepare('DELETE FROM hub_games WHERE hub_code=?').bind(code).run();
      await env.GAMES_DB.prepare('DELETE FROM hubs WHERE code=?').bind(code).run();
      return json({ ok: true });
    }

    return json({ error: 'not_found' }, 404);
  } catch (e) {
    console.error('games_db_error', (e && e.message) || String(e));
    return json({ error: 'db_error' }, 500);
  }
}

export default {
  async scheduled(event, env) {
    try { await sendPushReminders(env); } catch (e) { console.error('push_cron_fail', (e && e.message) || String(e)); }
    // Independent of push: a failure to send a reminder must never postpone an erasure someone asked
    // for, and vice versa.
    try { await purgeDeletedHouseholds(env); } catch (e) { console.error('purge_cron_fail', (e && e.message) || String(e)); }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    // Apple universal links. When Cubby is installed, iOS opens the APP (not Safari) for these paths —
    // so an email sign-in link taps straight into the wrapper (finishing in the webview's own storage
    // instead of Safari's, which is the whole reason email couldn't complete in the app), and a
    // /app/?go=… deep link opens the installed app. Must be application/json, no redirect, no auth.
    // Served for both the modern and legacy filenames iOS may request.
    if (url.pathname === '/.well-known/apple-app-site-association' || url.pathname === '/apple-app-site-association') {
      return new Response(JSON.stringify({
        applinks: {
          details: [{
            appIDs: ['F5NVQV7NVB.com.littlecubby.app'],
            // /app/* = the app itself + deep links; /__/auth/action = the email sign-in link the worker
            // mints. Query strings are ignored for matching, so the oobCode still rides along.
            components: [
              { '/': '/app/*' },
              { '/': '/__/auth/action', comment: 'email sign-in link' }
            ]
          }]
        }
      }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
    }
    if (url.pathname === '/api/send-invite') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      return sendInviteEmail(request, env, url);
    }
    if (url.pathname === '/api/send-signin-link') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      return sendSigninLink(request, env);
    }
    if (url.pathname === '/api/newsletter') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      return newsletterSignup(request, env);
    }
    if (url.pathname === '/api/health') {
      const now = Date.now();
      let cron = null;
      if (env.GAMES_DB) {
        try {
          const r = await env.GAMES_DB.prepare("SELECT value,updated_at FROM ops_state WHERE key='push_last_run'").first();
          if (r) { let s = {}; try { s = JSON.parse(r.value || '{}'); } catch (e) {} cron = { at: r.updated_at, ageMin: Math.round((now - r.updated_at) / 60000), ...s }; }
        } catch (e) {}
      }
      // Cron fires every 15 min; flag unhealthy if the last success is older than an hour.
      // Healthy has to mean RECENT **and** SUCCESSFUL. It used to mean only recent, which is exactly
      // how a cron that was 403-ing on every single run still reported healthy: the old push loop
      // swallowed a failed /users fetch with `break` and then logged `users: 0`, which reads as
      // "nobody had a reminder due" rather than "we never got to look". A heartbeat that cannot go
      // red is not a heartbeat.
      const cronFresh = cron ? (now - cron.at) < 60 * 60000 : null;
      /* A run that queued reminders and delivered NONE is not healthy, however cleanly it finished.
         Before this, a tick where every FCM call failed logged {due:40, sent:0, userErrors:0} and
         still reported cronHealthy:true, which is exactly how the July silent-403 went unnoticed for
         weeks. `failed` is only present on runs from this version onward, so an older record without
         it keeps the old meaning rather than reading as a new failure. */
      const cronDelivering = cron ? !(cron.failed > 0 && cron.sent === 0) : true;
      const cronHealthy = cron ? !!(cronFresh && !cron.queryError && cron.fallback !== 'failed' && cronDelivering) : null;
      return json({ ok: true, time: now, cron, cronHealthy, cronFresh, cronDelivering });
    }
    // Account deletion reaches into D1, which Firestore rules cannot govern: the guessing-game hubs
    // are keyed by Firebase uid. The client calls this while still signed in; we verify the token
    // ourselves and delete only rows owned by that exact uid.
    if (url.pathname === '/api/account/purge') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      return purgeAccountData(request, env);
    }
    if (url.pathname.startsWith('/api/game/')) {
      return gameRoute(request, env, url);
    }
    if (url.pathname.startsWith('/api/hub/')) {
      return hubRoute(request, env, url);
    }
    if (url.pathname === '/g' || url.pathname.startsWith('/g/')) {
      // Standalone guest page for any /g/<code>; the page reads the code from its own path.
      return env.ASSETS.fetch(new Request(new URL('/g/index.html', url), { headers: request.headers }));
    }
    if (url.pathname.startsWith('/__/')) {
      const upstream = new URL(url.pathname + url.search, 'https://little-log-a9caa.firebaseapp.com');
      return fetch(new Request(upstream, request));
    }
    return env.ASSETS.fetch(request);
  }
};
