/* Cubby Pro billing Worker (Cloudflare Workers, free tier).
   The ONLY writer of households/{hid}.pro. Three endpoints:
     POST /checkout  {hid, origin, email?}    -> Stripe Checkout session URL (7-day trial sub)
     POST /webhook   (Stripe-Signature)       -> updates households/{hid}.pro in Firestore
     POST /portal    {customer, origin}       -> Stripe billing portal URL
   Secrets (wrangler secret put ...): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
     STRIPE_PRICE_ID, FIREBASE_SA_KEY (the service-account JSON, one line).
   Vars (wrangler.toml): ALLOWED_ORIGINS (comma separated). */

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

/* ---------- Stripe helpers (REST, no SDK) ---------- */
async function stripe(env, path, params) {
  const body = new URLSearchParams();
  const flat = (obj, prefix) => Object.entries(obj).forEach(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object') flat(v, key); else body.append(key, String(v));
  });
  flat(params);
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const d = await r.json();
  if (!r.ok) throw new Error('stripe ' + path + ': ' + (d.error && d.error.message || r.status));
  return d;
}
async function stripeGet(env, path) {
  const r = await fetch('https://api.stripe.com/v1/' + path, { headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } });
  const d = await r.json();
  if (!r.ok) throw new Error('stripe get ' + path + ': ' + (d.error && d.error.message || r.status));
  return d;
}

/* ---------- endpoints ---------- */
async function checkout(request, env, cors) {
  const origin = request.headers.get('Origin') || '';
  if (!okOrigin(origin, env)) return json({ error: 'origin' }, cors, 403);
  const { hid, email } = await request.json();
  if (!hid || !/^[A-Za-z0-9_-]{4,80}$/.test(hid)) return json({ error: 'bad hid' }, cors, 400);
  const session = await stripe(env, 'checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': 1,
    'subscription_data[trial_period_days]': 7,
    'subscription_data[metadata][hid]': hid,
    client_reference_id: hid,
    allow_promotion_codes: 'true',
    ...(email ? { customer_email: email } : {}),
    success_url: origin + '/app/?pro=success',
    cancel_url: origin + '/app/?pro=cancel'
  });
  return json({ url: session.url }, cors);
}

async function portal(request, env, cors) {
  const origin = request.headers.get('Origin') || '';
  if (!okOrigin(origin, env)) return json({ error: 'origin' }, cors, 403);
  const { customer } = await request.json();
  if (!customer || !/^cus_[A-Za-z0-9]+$/.test(customer)) return json({ error: 'bad customer' }, cors, 400);
  const session = await stripe(env, 'billing_portal/sessions', { customer, return_url: origin + '/app/' });
  return json({ url: session.url }, cors);
}

async function webhook(request, env) {
  const payload = await request.text();
  const sig = request.headers.get('Stripe-Signature') || '';
  if (!(await verifyStripeSig(payload, sig, env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('bad signature', { status: 400 });
  }
  const event = JSON.parse(payload);
  const type = event.type;
  const obj = event.data && event.data.object || {};

  if (type === 'checkout.session.completed') {
    const hid = obj.client_reference_id;
    if (hid && obj.subscription) {
      const sub = await stripeGet(env, 'subscriptions/' + obj.subscription);
      await setPro(env, hid, sub, obj.customer);
    }
  } else if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    const hid = obj.metadata && obj.metadata.hid;
    if (hid) await setPro(env, hid, obj, obj.customer);
  }
  return new Response('ok', { status: 200 });
}

async function setPro(env, hid, sub, customer) {
  const status = sub.status || 'canceled';
  const active = ['trialing', 'active', 'past_due'].includes(status);
  const until = (sub.current_period_end || sub.trial_end || 0) * 1000;
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
        customer: { stringValue: String(customer || sub.customer || '') },
        updatedAt: { integerValue: String(Date.now()) }
      } } } }
    })
  });
  if (!r.ok) throw new Error('firestore ' + r.status + ': ' + await r.text());
}

/* ---------- Stripe webhook signature (HMAC SHA-256 of "t.payload") ---------- */
async function verifyStripeSig(payload, header, secret) {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5 min tolerance
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + payload));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

/* ---------- Google service-account token (RS256 JWT -> access token) ---------- */
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
