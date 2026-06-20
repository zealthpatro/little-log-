/* Cubby Pro billing Worker — Lemon Squeezy (Merchant of Record) variant.

   BUILT, NOT LIVE. Mirrors worker.js (Stripe, kept for reference). At go-live, point wrangler `main`
   at this file (or replace worker.js) and deploy — see README.md. It is the ONLY writer of
   households/{hid}.pro, and the entitlement vocabulary it writes (trialing|active|past_due|paused|
   canceled) is normalized to MATCH the existing client, so app-side isPro() needs ZERO changes —
   only PRO_CFG.checkoutUrl/portalUrl point here.

     POST /checkout  {hid, email?, plan?}  -> Lemon Squeezy hosted-checkout URL (variant carries the 7-day trial)
     POST /webhook   (X-Signature)         -> updates households/{hid}.pro in Firestore
     POST /portal    {subId}               -> fresh Lemon Squeezy customer-portal URL

   Secrets (wrangler secret put ...): LEMONSQUEEZY_API_KEY, LS_WEBHOOK_SECRET, FIREBASE_SA_KEY (one-line JSON).
   Vars (wrangler.toml): ALLOWED_ORIGINS, LS_STORE_ID, LS_VARIANT_MONTHLY, LS_VARIANT_ANNUAL.
   ⚠ Verify in Lemon Squeezy TEST MODE (test store) before flipping to live keys. */

const LS_API = 'https://api.lemonsqueezy.com/v1';
const LS_HEADERS = (env) => ({
  authorization: 'Bearer ' + env.LEMONSQUEEZY_API_KEY,
  accept: 'application/vnd.api+json',
  'content-type': 'application/vnd.api+json',
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/health') return json({ ok: true }, cors);
      if (request.method !== 'POST') return json({ error: 'POST only' }, cors, 405);
      if (url.pathname === '/checkout') return await checkout(request, env, cors);
      if (url.pathname === '/portal') return await portal(request, env, cors);
      if (url.pathname === '/webhook') return await webhook(request, env);
      return json({ error: 'not found' }, cors, 404);
    } catch (e) {
      console.error(e && e.stack || e);
      return json({ error: 'internal' }, cors, 500);
    }
  }
};

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || ''),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin'
  };
}
function json(obj, headers, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { ...headers, 'content-type': 'application/json' } });
}
function okOrigin(origin, env) {
  return (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).includes(origin);
}

/* ---------- endpoints ---------- */
async function checkout(request, env, cors) {
  const origin = request.headers.get('Origin') || '';
  if (!okOrigin(origin, env)) return json({ error: 'origin' }, cors, 403);
  const { hid, email, plan } = await request.json();
  if (!hid || !/^[A-Za-z0-9_-]{4,80}$/.test(hid)) return json({ error: 'bad hid' }, cors, 400);
  const variantId = plan === 'monthly' ? env.LS_VARIANT_MONTHLY : env.LS_VARIANT_ANNUAL;

  const r = await fetch(LS_API + '/checkouts', {
    method: 'POST',
    headers: LS_HEADERS(env),
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          // `custom` is echoed back in the webhook (meta.custom_data) so we can map to the household.
          checkout_data: { email: email || undefined, custom: { hid } },
          product_options: { redirect_url: origin + '/app/?pro=success' },
          checkout_options: { embed: false }
        },
        relationships: {
          store: { data: { type: 'stores', id: String(env.LS_STORE_ID) } },
          variant: { data: { type: 'variants', id: String(variantId) } }
        }
      }
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('ls checkout: ' + JSON.stringify(d).slice(0, 300));
  return json({ url: d.data.attributes.url }, cors);
}

async function portal(request, env, cors) {
  const origin = request.headers.get('Origin') || '';
  if (!okOrigin(origin, env)) return json({ error: 'origin' }, cors, 403);
  const { subId } = await request.json();
  if (!subId || !/^\d{1,20}$/.test(String(subId))) return json({ error: 'bad subId' }, cors, 400);
  const r = await fetch(LS_API + '/subscriptions/' + subId, { headers: LS_HEADERS(env) });
  const d = await r.json();
  if (!r.ok) throw new Error('ls portal: ' + JSON.stringify(d).slice(0, 300));
  const portalUrl = d.data.attributes.urls && d.data.attributes.urls.customer_portal;
  return json({ url: portalUrl }, cors);
}

async function webhook(request, env) {
  const payload = await request.text();
  const sig = request.headers.get('X-Signature') || '';
  if (!(await verifyLemonSig(payload, sig, env.LS_WEBHOOK_SECRET))) {
    return new Response('bad signature', { status: 400 });
  }
  const event = JSON.parse(payload);
  const name = event.meta && event.meta.event_name;
  const hid = event.meta && event.meta.custom_data && event.meta.custom_data.hid;
  const data = event.data || {};
  // All subscription_* events carry the full subscription object; map every one to the entitlement.
  if (hid && name && name.indexOf('subscription_') === 0 && data.type === 'subscriptions') {
    await setPro(env, hid, data.attributes || {}, String(data.id || ''));
  }
  return new Response('ok', { status: 200 });
}

// Normalize Lemon Squeezy status -> the SAME vocabulary the Stripe worker wrote, so the client's
// isPro() (trialing|active|past_due + 3-day grace) is unchanged.
const LS_STATUS = { on_trial: 'trialing', active: 'active', past_due: 'past_due', paused: 'paused', unpaid: 'past_due', cancelled: 'canceled', expired: 'canceled' };

async function setPro(env, hid, attrs, subId) {
  const status = LS_STATUS[attrs.status] || 'canceled';
  const active = ['trialing', 'active', 'past_due'].includes(status);
  const endIso = attrs.renews_at || attrs.ends_at || attrs.trial_ends_at || null;
  const until = endIso ? Date.parse(endIso) || 0 : 0; // ms
  const portalUrl = (attrs.urls && attrs.urls.customer_portal) || '';
  const sa = JSON.parse(env.FIREBASE_SA_KEY);
  const token = await googleToken(sa);
  const doc = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/households/${encodeURIComponent(hid)}?updateMask.fieldPaths=pro`;
  const r = await fetch(doc, {
    method: 'PATCH',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({
      fields: { pro: { mapValue: { fields: {
        active: { booleanValue: active },
        plan: { stringValue: 'base' },
        status: { stringValue: status },
        until: { integerValue: String(until) },
        customer: { stringValue: String(attrs.customer_id || '') },
        subId: { stringValue: String(subId || '') },
        portalUrl: { stringValue: portalUrl },
        updatedAt: { integerValue: String(Date.now()) }
      } } } }
    })
  });
  if (!r.ok) throw new Error('firestore ' + r.status + ': ' + await r.text());
}

/* ---------- Lemon Squeezy webhook signature: HMAC-SHA256 hex of the raw body ---------- */
async function verifyLemonSig(payload, header, secret) {
  if (!header || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

/* ---------- Google service-account token (RS256 JWT -> access token) — identical to worker.js ---------- */
async function googleToken(sa) {
  const iat = Math.floor(Date.now() / 1000);
  const enc = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = enc(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat, exp: iat + 3600
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(header + '.' + claims));
  const jwt = header + '.' + claims + '.' + btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('google token: ' + JSON.stringify(d));
  return d.access_token;
}
