/* END TO END PROOF that a push actually arrives. Not a mirror, not a source assertion.
 *
 * Mints a REAL FCM web-push token in a real browser against the LIVE site, sends a REAL message to
 * it through FCM HTTP v1 with the service account, and waits for the notification to appear in the
 * service worker's own notification list. If this passes, web push works. If it fails, it works on
 * nobody's phone either, whatever the unit tests say.
 *
 * This exists because everything about push was green in theory and dead in practice: two service
 * workers fought over the /app/ scope so the FCM handler was evicted on every page load, and nobody
 * noticed for months because REMINDERS_LIVE was false and no token had ever been minted.
 *
 *   node tools/push_e2e.js [origin]      default https://little-cubby.com
 *
 * Needs tools/serviceAccountKey.json (gitignored). Its contents are never printed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = process.argv[2] || 'https://little-cubby.com';
const SA_PATH = path.join(__dirname, 'serviceAccountKey.json');
const VAPID = 'BJsMLPFLN5hLbJsdAs2ovSVaRii-sxjaz3bLha7ffXB7Iq4N6vUHKwlH6g9zBuyNUkgAGRKk-ii5VDMq-9tto-k';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n + (x !== undefined ? '  ' + x : '')); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + x : '')); } };

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify(claim));
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
  const jwt = unsigned + '.' + b64u(sig);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('no access token: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

(async () => {
  console.log('\nharness');
  if (!fs.existsSync(SA_PATH)) { console.log('  FAIL tools/serviceAccountKey.json is missing; cannot send a real push'); process.exit(1); }
  const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
  ok('service account loaded', !!sa.client_email && !!sa.private_key, 'project ' + sa.project_id);
  const token = await accessToken(sa);
  ok('minted an FCM access token', !!token);

  /* HEADFUL by default. Headless Chrome mints a valid FCM token and FCM returns 200, but it does not
     hold a connection to the push service, so the message is accepted and never delivered: the run
     looks like a product failure when it is an environment one. Set PUSH_E2E_HEADLESS=1 to see that
     for yourself. */
  const headless = process.env.PUSH_E2E_HEADLESS === '1' ? 'new' : false;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(ORIGIN, ['notifications']);

  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  console.log('\n1. the app registers exactly one service worker at /app/');
  await page.goto(ORIGIN + '/app/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await new Promise((r) => setTimeout(r, 1200));
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations())
    .map((x) => ({ scope: x.scope, script: (x.active && x.active.scriptURL) || '' })));
  const atApp = regs.filter((r) => r.scope.endsWith('/app/'));
  ok('exactly one registration at /app/', atApp.length === 1, JSON.stringify(atApp.map((r) => r.script.split('/').pop())));
  ok('and it is sw.js, the one carrying the push handler', atApp[0] && /sw\.js$/.test(atApp[0].script));

  console.log('\n2. mint a REAL web push token against live FCM');
  const tok = await page.evaluate(async (vapid) => {
    try {
      if (!(window.firebase && firebase.messaging)) return { err: 'firebase messaging not loaded' };
      if (firebase.messaging.isSupported && !firebase.messaging.isSupported()) return { err: 'messaging unsupported in this browser' };
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return { err: 'permission ' + perm };
      const reg = await navigator.serviceWorker.ready;
      const t = await firebase.messaging().getToken({ vapidKey: vapid, serviceWorkerRegistration: reg });
      return { tok: t };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  }, VAPID);
  if (tok.err) {
    ok('got an FCM registration token', false, tok.err);
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    console.log('PUSH-E2E: FAIL (could not mint a token, so delivery is unproven)');
    await browser.close(); process.exit(1);
  }
  ok('got an FCM registration token', !!tok.tok, tok.tok.slice(0, 12) + '...(' + tok.tok.length + ' chars)');

  console.log('\n3. send a REAL message to it through FCM HTTP v1');
  const tag = 'e2e-' + Date.now();
  const res = await fetch('https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { token: tok.tok,
      notification: { title: 'Cubby delivery check', body: 'If you can read this, push works.' },
      data: { tag, cat: 'critical' },
      webpush: { fcmOptions: { link: ORIGIN + '/app/' } } } })
  });
  const body = await res.text();
  ok('FCM accepted the message', res.ok, res.status + (res.ok ? '' : ' ' + body.slice(0, 300)));
  if (!res.ok) {
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    console.log('PUSH-E2E: FAIL (FCM refused the send)');
    await browser.close(); process.exit(1);
  }

  console.log('\n4. the service worker actually received it and showed a notification');
  let shown = null;
  for (let i = 0; i < 30; i++) {
    shown = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const ns = await reg.getNotifications();
      return ns.map((n) => ({ title: n.title, body: n.body, tag: n.tag }));
    });
    if (shown && shown.length) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  ok('a notification was displayed by the service worker', !!(shown && shown.length),
     shown && shown.length ? JSON.stringify(shown[0]) : 'nothing after 30s');
  if (shown && shown.length) {
    ok('it carries the title we sent', shown.some((n) => n.title === 'Cubby delivery check'));
    ok('and the tag, so a retry collapses instead of stacking', shown.some((n) => n.tag === tag));
  }

  ok('no page errors during the run', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PUSH-E2E: FAIL' : 'PUSH-E2E: PASS — a real push was delivered end to end');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('runner error:', (e && e.message) || e); process.exit(2); });
